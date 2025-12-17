import { 
  GoogleGenAI,
  GoogleGenAIOptions,
  GenerateContentConfig,
  Part,
  SafetySetting, 
  HarmCategory, 
  HarmBlockThreshold,
  ApiError,
  GenerateContentResponse,
  ThinkingLevel,
} from "@google/genai";
import { requestUrl } from "obsidian";
import { getSettings } from "src/plugin";
import { DEFAULT_SETTINGS } from "src/settings/SettingsTab";
import { prepareModelInputs } from "src/backend/managers/prompts/inputs";
import { imageToBase64 } from "src/utils/parsing/imageBase64";


// Function that calls the llm model without chat history and tools binded
export async function callModel(
  system: string,
  user: string,
  files: File[],
): Promise<string> {
  const settings = getSettings();

  if (settings.provider === "google") {
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
      systemInstruction: system,
      safetySettings: safetySettings,
      thinkingConfig: {
        includeThoughts: true,
      },
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

    const inputs: Part[] = await prepareModelInputs(user, files);

    // Call the model
    let response: GenerateContentResponse | undefined;
    try {
      response = await ai.models.generateContent({
        model: settings.model,
        contents: inputs,
        config: generationConfig,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 403) throw new Error("API key not set, or isn't valid.")
        if (error.status === 429) throw new Error("API quota exceeded. Please check your Google Cloud account.");
        if (error.status === 503) throw new Error("API service overloaded. Please try again later.");
        throw new Error(`API Error: ${error.message}`);
      }
      throw new Error(`Unexpected Error: ${String(error)}`);
    }

    if (!response) throw new Error("No message generated.");
    return response.text || "";
  } else {
    // OpenRouter or Local
    const apiKey = settings.provider === "openrouter" ? settings.openRouterApiKey : "ollama";
    let baseURL = settings.provider === "openrouter" ? "https://openrouter.ai/api/v1" : settings.localModelUrl;

    // Ensure baseURL doesn't end with slash
    if (baseURL.endsWith("/")) baseURL = baseURL.slice(0, -1);

    const content: any[] = [{ type: "text", text: user }];
    for (const file of files) {
      const base64 = await imageToBase64(file);
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${file.type};base64,${base64.replace(/^data:.*;base64,/, "")}`,
        },
      });
    }

    const messages = [
      { role: "system", content: system },
      { role: "user", content: content },
    ];

    const body = {
      model: settings.model,
      messages: messages,
      temperature: settings.temperature !== "Default" ? Number(settings.temperature) : 1,
      max_tokens: settings.maxOutputTokens !== "Default" ? Number(settings.maxOutputTokens) : undefined,
    };

    try {
      const response = await requestUrl({
        url: `${baseURL}/chat/completions`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (response.status >= 400) {
        throw new Error(`API Error: ${response.status} - ${response.text}`);
      }

      const data = response.json;
      return data.choices[0].message.content || "";
    } catch (error) {
       throw new Error(`API Error: ${String(error)}`);
    }
  }
}
