import {
  GoogleGenAI,
  GoogleGenAIOptions,
  GenerateContentConfig,
  GenerateContentResponse,
  Chat,
  Content,
  Part,
  SafetySetting, 
  HarmCategory, 
  HarmBlockThreshold,
  ApiError,
  ThinkingLevel,
  Type,
} from "@google/genai";
import OpenAI from "openai";
import { getSettings } from "src/plugin";
import { Message, Attachment, ToolCall } from "src/types/chat";
import { prepareModelInputs, buildChatHistory } from "src/backend/managers/prompts/inputs";
import { agentSystemPrompt } from "src/backend/managers/prompts/library";  
import { callableFunctionDeclarations, executeFunction } from "src/backend/managers/functionRunner";
import { DEFAULT_SETTINGS } from "src/settings/SettingsTab";
import { imageToBase64 } from "src/utils/parsing/imageBase64";

// Function that calls the agent with chat history and tools binded
export async function callAgent(
  conversation: Message[],
  message: string,
  attachments: Attachment[],
  files: File[],
  updateAiMessage: (m: string, r: string, t: ToolCall[]) => void,
): Promise<void> {
  const settings = getSettings();

  if (settings.provider !== "google") {
    await callOpenAIAgent(conversation, message, attachments, files, updateAiMessage);
    return;
  }

  // Initialize model and its configuration
  const config: GoogleGenAIOptions = { apiKey: settings.googleApiKey, apiVersion: "v1beta" };
  const ai = new GoogleGenAI(config);

  const safetySettings: SafetySetting[] = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ];

  const generationConfig: GenerateContentConfig = {
    systemInstruction: agentSystemPrompt,
    safetySettings: safetySettings,
    thinkingConfig: {
      includeThoughts: true,
    },
    tools: [{
      functionDeclarations: callableFunctionDeclarations,
    }]
  };
  // Special settings for Gemini 3 models
  if (settings.model.includes("3") && settings.thinkingLevel !== DEFAULT_SETTINGS.thinkingLevel) {
    generationConfig.thinkingConfig!.thinkingLevel = settings.thinkingLevel === "Low" 
      ? ThinkingLevel.LOW 
      : ThinkingLevel.HIGH;
  }
  if (settings.temperature !== DEFAULT_SETTINGS.temperature) {
    generationConfig.temperature = Number(settings.temperature);
  }
  if (settings.maxOutputTokens !== DEFAULT_SETTINGS.maxOutputTokens) {
    generationConfig.maxOutputTokens = Number(settings.maxOutputTokens);
  }

  // Build chat
  const chatHistory = conversation.length > 0 ? await buildChatHistory(conversation) : [];  
  const chat: Chat = ai.chats.create({
    model: settings.model,
    history: chatHistory,
    config: generationConfig,
  });

  // Prepare user inputs
  let fullUserMessage: string = message;
  if (attachments.length > 0) {
    fullUserMessage += `\n###\nAttached Obsidian notes: `
    for (const note of attachments) {
      fullUserMessage += `\n${note.path}`;
    }
    fullUserMessage += `\n###\n`
  }
  const input: Part[] = await prepareModelInputs(fullUserMessage, files);
  
  const executedFunctionIds = new Set<string>();
  await sendMessageToChat(
    1, 
    ai,
    settings.model,
    generationConfig,
    chat, 
    chatHistory,
    input, 
    updateAiMessage, 
    executedFunctionIds
  );
}


// Sends the message to the chat history and process the response
async function sendMessageToChat(
  turn: number,
  ai: GoogleGenAI,
  model: string,
  generationConfig: GenerateContentConfig,
  chat: Chat,
  originalHistory: Content[],
  input: Part[], 
  updateAiMessage: (m: string, r: string, t: ToolCall[]) => void,
  executedFunctionIds: Set<string>,
): Promise<void> {
  if (turn > 5) {
    throw new Error("Maximum tool execution depth reached. This maximum number of turns is set to avoid infinite loops.");
  }

  try {
    const stream = await chat.sendMessageStream({ message: input });

    // Prcess response
    for await (const chunk of stream) {
      // Manage reasoning
      let allThoughs: string[] = [];
      const candidates = chunk.candidates || [];

      if (chunk.candidates) {
        for (const cand of candidates) {
          const parts = cand.content?.parts || [];
          for (const part of parts) {
            if (part.thought && part.text) {
              allThoughs.push(part.text);
            }
          }
        }
      }

      // Update the message with the chunk
      updateAiMessage(chunk.text || "", allThoughs.join("\n"), []);
    
      // Execute function calls if any
      if (chunk.functionCalls && chunk.functionCalls.length > 0) {
        await manageFunctionCall(turn, ai, model, generationConfig, originalHistory, input, chunk, updateAiMessage, executedFunctionIds);
        continue;
      }
    };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 403) throw new Error("API key not set, or isn't valid.")
      if (error.status === 429) throw new Error("API quota exceeded. Please check your Google Cloud account.");
      if (error.status === 503) throw new Error("API service overloaded. Please try again later.");
      throw new Error(`API Error: ${error.message}`);
    }
    throw new Error(`Unexpected Error: ${String(error)}`);
  }
}


// Execute the function with the provided arguments and return the responses to the agent
async function manageFunctionCall(
  turn: number,
  ai: GoogleGenAI,
  model: string,
  generationConfig: GenerateContentConfig,
  originalHistory: Content[],
  userInput: Part[],
  chunk: GenerateContentResponse,
  updateAiMessage: (m: string, r: string, t: ToolCall[]) => void,
  executedFunctionIds: Set<string>,
): Promise<void> {
  const settings = getSettings();

  if (!chunk.candidates || chunk.candidates.length === 0) return;
  const cand = chunk.candidates[0];
  if (!cand) return;
    
  // Extract function call
  const parts: Part[] = cand.content?.parts || [];
  const fcParts = parts.filter(p => !!p.functionCall);
  if (fcParts.length === 0) return;

  // One function execution at a time
  const fcPartCandidate = fcParts[0];
  const funcCall = fcPartCandidate.functionCall!;
  if (!funcCall || !funcCall.name) return;

  // Add executed function data to avoid double executions (this calls do not have id property)
  const fId = funcCall.name + JSON.stringify(funcCall.args || {});
  if (executedFunctionIds.has(fId)) return;
  executedFunctionIds.add(fId);
    
  const response = await executeFunction(funcCall);

  // Update the AI message with the function response
  updateAiMessage("", "", [{
    name: funcCall.name,
    args: funcCall.args,
    response: response,
  }]);

  // Create input parts
  const functionResponsePart: Part = {
    functionResponse: {
      name: funcCall.name,
      response: response,
    }
  };

  // The model function call Content
  const modelContent: Content = cand.content!;
  const userContent: Content = {
    role: "user",
    parts: userInput,
  };

  const newHistory = [...originalHistory, userContent, modelContent];

  // Create a new chat with the updated history
  const newChat: Chat = ai.chats.create({
    model: model,
    history: newHistory,
    config: generationConfig,
  })

  const nextInput: Part[] = [ functionResponsePart ]

  // Call again the agent with the newHistory
  await sendMessageToChat(
    turn+1, 
    ai, 
    model, 
    generationConfig, 
    newChat, 
    newHistory, 
    nextInput, 
    updateAiMessage, 
    executedFunctionIds
  );
}

async function callOpenAIAgent(
  conversation: Message[],
  message: string,
  attachments: Attachment[],
  files: File[],
  updateAiMessage: (m: string, r: string, t: ToolCall[]) => void,
) {
    const settings = getSettings();
    const apiKey = settings.provider === "openrouter" ? settings.openRouterApiKey : "ollama";
    const baseURL = settings.provider === "openrouter" ? "https://openrouter.ai/api/v1" : settings.localModelUrl;

    const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: baseURL,
        dangerouslyAllowBrowser: true,
    });

    // Prepare tools
    const tools = callableFunctionDeclarations.map(decl => ({
        type: "function" as const,
        function: {
            name: decl.name,
            description: decl.description,
            parameters: convertSchema(decl.parameters)
        }
    }));

    // Prepare messages
    const messages = await buildOpenAIChatHistory(conversation);
    messages.unshift({ role: "system", content: agentSystemPrompt });

    // Add current user message
    let content: any[] = [{ type: "text", text: message }];
    if (attachments.length > 0) {
        let attachmentText = "\n###\nAttached Obsidian notes: ";
        for (const note of attachments) {
            attachmentText += `\n${note.path}`;
        }
        attachmentText += `\n###\n`;
        content[0].text += attachmentText;
    }

    for (const file of files) {
        const base64 = await imageToBase64(file);
        content.push({
            type: "image_url",
            image_url: {
                url: `data:${file.type};base64,${base64.replace(/^data:.*;base64,/, "")}`
            }
        });
    }

    messages.push({ role: "user", content: content });

    // Main loop
    let turn = 0;
    const maxTurns = 5;

    while (turn < maxTurns) {
        const stream = await openai.chat.completions.create({
            model: settings.model,
            messages: messages as any,
            tools: tools,
            stream: true,
            temperature: settings.temperature !== "Default" ? Number(settings.temperature) : 1,
            max_tokens: settings.maxOutputTokens !== "Default" ? Number(settings.maxOutputTokens) : undefined,
        });

        let accumulatedContent = "";
        let toolCalls: any[] = [];

        for await (const chunk of stream) {
            const delta = chunk.choices[0].delta;

            if (delta.content) {
                accumulatedContent += delta.content;
                updateAiMessage(delta.content, "", []);
            }

            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (tc.index !== undefined) {
                        if (!toolCalls[tc.index]) {
                            toolCalls[tc.index] = { id: tc.id, function: { name: "", arguments: "" } };
                        }
                        if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
                        if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
                    }
                }
            }
        }

        if (toolCalls.length > 0) {
            // Add assistant message with tool calls
            messages.push({
                role: "assistant",
                content: accumulatedContent || null,
                tool_calls: toolCalls.map(tc => ({
                    id: tc.id,
                    type: "function",
                    function: tc.function
                }))
            });

            // Execute tools
            for (const tc of toolCalls) {
                const funcName = tc.function.name;
                let funcArgs = {};
                try {
                    funcArgs = JSON.parse(tc.function.arguments);
                } catch (e) {
                    console.error("Failed to parse tool arguments", e);
                }

                const googleFuncCall = { name: funcName, args: funcArgs };
                const response = await executeFunction(googleFuncCall);

                updateAiMessage("", "", [{
                    name: funcName,
                    args: funcArgs,
                    response: response
                }]);

                messages.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify(response)
                });
            }
            turn++;
        } else {
            // No tool calls, we are done
            break;
        }
    }
}

function convertSchema(schema: any): any {
    if (!schema) return undefined;

    const newSchema: any = { ...schema };
    if (newSchema.type) {
        if (newSchema.type === Type.STRING) newSchema.type = "string";
        else if (newSchema.type === Type.NUMBER) newSchema.type = "number";
        else if (newSchema.type === Type.INTEGER) newSchema.type = "integer";
        else if (newSchema.type === Type.BOOLEAN) newSchema.type = "boolean";
        else if (newSchema.type === Type.ARRAY) newSchema.type = "array";
        else if (newSchema.type === Type.OBJECT) newSchema.type = "object";
    }

    if (newSchema.properties) {
        for (const key in newSchema.properties) {
            newSchema.properties[key] = convertSchema(newSchema.properties[key]);
        }
    }
    if (newSchema.items) {
        newSchema.items = convertSchema(newSchema.items);
    }

    return newSchema;
}

async function buildOpenAIChatHistory(conversation: Message[]): Promise<any[]> {
    const settings = getSettings();
    const maxHistoryTurns = settings.maxHistoryTurns;
    if (maxHistoryTurns === 0) return [];

    let selectedMessages = conversation.slice(-maxHistoryTurns * 2);
    const history: any[] = [];

    for (const msg of selectedMessages) {
        if (msg.sender === "error") continue;

        if (msg.sender === "user") {
             history.push({ role: "user", content: msg.content });
        } else if (msg.sender === "bot") {
             if (msg.toolCalls && msg.toolCalls.length > 0) {
                 const toolCalls = msg.toolCalls.map((tc, idx) => ({
                     id: `call_${idx}`,
                     type: "function",
                     function: {
                         name: tc.name,
                         arguments: JSON.stringify(tc.args)
                     }
                 }));

                 history.push({
                     role: "assistant",
                     content: msg.content || null,
                     tool_calls: toolCalls
                 });

                 for (let i = 0; i < msg.toolCalls.length; i++) {
                     history.push({
                         role: "tool",
                         tool_call_id: `call_${i}`,
                         content: JSON.stringify(msg.toolCalls[i].response)
                     });
                 }
             } else {
                 history.push({ role: "assistant", content: msg.content });
             }
        }
    }
    return history;
}
