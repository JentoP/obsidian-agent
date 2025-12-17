<h1 align="center">Obsidian Agent</h1>

<p align="center">
  Lend your vault to an AI agent. Read, write, and search your notes with AI.<br/>
</p>

<div align="center">
  <div>
    <img src="https://img.shields.io/badge/Obsidian-%23483699.svg?&logo=obsidian&logoColor=white" alt="Obsidian">
    <img src="https://img.shields.io/badge/Google%20Gemini-886FBF?logo=googlegemini&logoColor=fff" alt="Google">
    <a href="https://coff.ee/themanuelml" style="text-decoration: none">
      <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?&logo=buy-me-a-coffee&logoColor=black" alt="Buy mea coffe">
    </a>
  </div>
  <div>
    <img src="https://img.shields.io/badge/Licence-MIT-D93192" alt="Release">
    <img src="https://img.shields.io/github/stars/TheManuelML/obsidian-agent?style=social" alt="GitHub stars">
  </div>
</div>

## 🚀 Overview
A simple and lightweight AI extension for Obsidian. Delegate basic tasks to an agent that can write, edit, and create notes and folders within your vault.

It features a user-friendly UI, inspired by other agentic apps.

<p>
  <img src="imgs/demo.png" alt="Obsidian Agent Chat Overview"/>
</p>


## 🧠 Getting Started

1. Download from **Community Plugins** in Obsidian or clone the repository inside your `~/vault/.obsidian/plugins/` folder.
2. Enable the plugin from Obsidian's settings panel.
3. Configure your preferred provider in the settings:
    - **Google Gemini**: Add your Google API key.
    - **OpenRouter**: Add your OpenRouter API key.
    - **Local**: Configure your local model URL (e.g., `http://localhost:11434/v1` for Ollama).

> Make sure you have the necessary API keys or local server running.


## ✨ Core Features
<ul>
  <li><b>Multi-provider Support:</b> Use Google Gemini, OpenRouter, or local models (Ollama).</li>
  <li><b>Note Reading:</b> Understands and edit your notes.</li>
  <li><b>Web search:</b> Search information across the web.</li>
  <li><b>Customizable:</b> Tweak agent rules to fit your workflow.</li>
  <li><b>Built-in actions:</b> Right click on selected text to open the menu items.</li>
</ul>


## 🛠️ Tools

The agent can use the following tools to interact with your vault:

- **Create note**: Create a new note in your vault, e.g: *Create a note titled 'Project Ideas'*
- **Read note**: Read the content of a note, e.g: *Read the active note*
- **Edit note**: Edit an existing note, e.g: *Add a summary of this text: [...] to the note 'Book Review'*
- **Create folder**: Create a new folder, e.g: *Create a folder called '2024 Plans'*
- **List files**: List files in a folder, e.g: *List all files in the folder 'Research'*
- **Vault Search**: Search for content across your vault, e.g: *Search if it exist a note called 'AI agent'*
- **Note filtering**: Return note paths that fall inside a date range, e.g: *Give me yesterday's notes*
- **Web search**: Search for content on the web. e.g: *Search on the web for todays temperature in Austin, Texas*

Also you can right click over select text, in your markdown notes, to summarize or ask the agent about the selection.

## 🟡 Disclosures
This plugin connects to remote AI services (Google, OpenRouter) or local servers to process your requests.

> **Why is this needed?**  
> The AI models that power these features run on external servers (or your local machine) and require a connection. Your notes or queries are sent securely to the selected provider for processing, and the results are only returned to your vault.

To use cloud-based AI services, you must set the corresponding API key. You are responsible for obtaining and managing your API keys.

## 🫱🏼‍🫲🏼 Contributing & Support

- Found a bug? Open an issue [here](https://github.com/TheManuelML/obsidian-agent/issues).  
- Want to contribute? Create a new pull request.
