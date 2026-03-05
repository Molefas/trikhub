/**
 * Python agent scaffold template.
 *
 * Generates a minimal Python agent project ready to consume triks via TrikGateway.
 * Mirrors agent-typescript.ts but targets a Python environment.
 */

import type { CreateAgentConfig } from './agent-typescript.js';

// ============================================================================
// Provider config
// ============================================================================

interface ProviderInfo {
  importPath: string;
  className: string;
  pipPackage: string;
  defaultModel: string;
  envVar: string;
}

const PROVIDERS: Record<string, ProviderInfo> = {
  openai: {
    importPath: 'langchain_openai',
    className: 'ChatOpenAI',
    pipPackage: 'langchain-openai',
    defaultModel: 'gpt-4o-mini',
    envVar: 'OPENAI_API_KEY',
  },
  anthropic: {
    importPath: 'langchain_anthropic',
    className: 'ChatAnthropic',
    pipPackage: 'langchain-anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    envVar: 'ANTHROPIC_API_KEY',
  },
  google: {
    importPath: 'langchain_google_genai',
    className: 'ChatGoogleGenerativeAI',
    pipPackage: 'langchain-google-genai',
    defaultModel: 'gemini-2.0-flash',
    envVar: 'GOOGLE_API_KEY',
  },
};

// ============================================================================
// File generators
// ============================================================================

function generatePyprojectToml(config: CreateAgentConfig): string {
  const provider = PROVIDERS[config.provider];
  return `[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "${config.name}"
version = "0.1.0"
description = "AI agent powered by TrikHub"
requires-python = ">=3.10"

dependencies = [
    "${provider.pipPackage}>=1.0.0",
    "langchain-core>=0.3.0",
    "langgraph>=0.2.0",
    "trikhub>=0.6.0",
    "python-dotenv>=1.0.0",${config.channels === 'cli+telegram' ? `\n    "python-telegram-bot>=21.0",` : ''}
]
`;
}

function generateEnvExample(config: CreateAgentConfig): string {
  const provider = PROVIDERS[config.provider];
  let env = `${provider.envVar}=your-api-key-here\n`;
  if (config.channels === 'cli+telegram') {
    env += `TELEGRAM_BOT_TOKEN=your-token-from-botfather\n`;
  }
  return env;
}

function generateGitignore(): string {
  return `__pycache__/
*.pyc
*.egg-info/
dist/
build/
.venv/
.env
`;
}

function generateTrikhubConfig(): string {
  return JSON.stringify({ triks: [] }, null, 2);
}

function generateAgentPy(config: CreateAgentConfig): string {
  const provider = PROVIDERS[config.provider];
  return `"""AI agent with TrikHub integration."""

from __future__ import annotations

from ${provider.importPath} import ${provider.className}
from langgraph.prebuilt import create_react_agent

from trikhub.langchain import enhance, EnhanceOptions

SYSTEM_PROMPT = """You are a helpful agent spawned by Trikhub. A user has installed you and you are ready to install Triks to help them with various tasks. You can call any tools provided by the installed Triks to assist the user.
Feel free to propose a few starting Triks that the user should use to test out your capabilitites:
- @molefas/trikster: The first Trik anyone should have. This allows you to install other Triks, which will expand your capabilities with new tools and handoffs.
- @molefas/site-builder: A Demo Trik for building websites. It's meant to showcase how Triks can generate files and execute commands in a safe environment (docker container). With this Trik, you can build a static website by describing it to the agent, which will generate the necessary HTML/CSS/JS files and even run a local server for you to preview it.
- @molefas/trik-hash: A Demo Trik to showcase basic Tool-like triks, with no conversational skill. It provides a simple hashing tool that can hash any input with various algorithms (md5, sha256, etc). It's a great starting point to understand how to call tools from your agent.
- @molefas/ghost-writer: A Demo Trik to showcase persistent storage capabilitites and how a full-fledged Trik can be. It also exposes a web interface for users to interact with their data.

Other useful tips:
- Users can do trik list to see installed triks and trik search <query> to find new ones.
- Users can refer to the Trikhub documentation at https://docs.trikhub.com for more details on how to use and create triks.
- If you've chosen the Telegram installation, check the readme for instructions on how to interact with your agent via Telegram.

When a trik can handle the user's request, use the appropriate tool."""


async def initialize_agent():
    model = ${provider.className}(model="${provider.defaultModel}")

    app = await enhance(None, EnhanceOptions(
        create_agent=lambda trik_tools: create_react_agent(
            model=model,
            tools=list(trik_tools),
            prompt=SYSTEM_PROMPT,
        ),
    ))

    return app
`;
}

function generateCliPy(): string {
  return `#!/usr/bin/env python3
"""CLI for the TrikHub-powered agent."""

from __future__ import annotations

import asyncio

from dotenv import load_dotenv

load_dotenv()

from agent import initialize_agent


async def main() -> None:
    print("Loading agent...\\n")

    app = await initialize_agent()

    loaded_triks = app.get_loaded_triks()
    if loaded_triks:
        print(f"Loaded triks: {', '.join(loaded_triks)}")
    print('Type "/back" to return from a trik handoff, "exit" to quit.')
    print('Tip: Ask the Agent what to do next\\n')

    session_id = f"cli-{id(app)}"

    while True:
        try:
            user_input = input("You: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\\n\\nGoodbye!")
            break

        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit"):
            print("\\nGoodbye!")
            break

        try:
            result = await app.process_message(user_input, session_id)

            if result.source == "system":
                print(f"\\n\\033[2m{result.message}\\033[0m\\n")
            elif result.source != "main":
                print(f"\\n[{result.source}] {result.message}\\n")
            else:
                print(f"\\nAssistant: {result.message}\\n")
        except Exception as e:
            print(f"\\nError: {e}")
            print("Please try again.\\n")


if __name__ == "__main__":
    asyncio.run(main())
`;
}

function generateTelegramPy(): string {
  return `#!/usr/bin/env python3
"""Telegram bot for the TrikHub-powered agent."""

from __future__ import annotations

import asyncio
import logging
import os
import time

from dotenv import load_dotenv

load_dotenv()

from telegram import Update
from telegram.ext import Application, MessageHandler, filters, ContextTypes

from agent import initialize_agent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main() -> None:
    print("Loading agent...\\n")

    app = await initialize_agent()

    loaded_triks = app.get_loaded_triks()
    if loaded_triks:
        print(f"Loaded triks: {', '.join(loaded_triks)}")

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("TELEGRAM_BOT_TOKEN is not set in .env")
        raise SystemExit(1)

    session_id = f"telegram-{int(time.time())}"

    async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not update.message or not update.message.text:
            return
        try:
            result = await app.process_message(update.message.text, session_id)
            await update.message.reply_text(result.message)
        except Exception as e:
            logger.error("Error processing message: %s", e)
            await update.message.reply_text("Something went wrong. Please try again.")

    application = Application.builder().token(token).build()
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    print("\\nTelegram bot started! Send a message to your bot.\\n")
    await application.run_polling()


if __name__ == "__main__":
    asyncio.run(main())
`;
}

function generateReadme(config: CreateAgentConfig): string {
  const provider = PROVIDERS[config.provider];
  const hasTelegram = config.channels === 'cli+telegram';

  let readme = `# ${config.name}

An AI agent powered by [TrikHub](https://trikhub.com). This agent uses **${provider.className}** and can be extended with triks — composable capabilities that plug into your agent.

## What can this agent do?

Out of the box, your agent is a general-purpose assistant. Its real power comes from **triks** — install them to give your agent new capabilities:

\`\`\`bash
# Browse and search available triks
trik search <query>

# Install a trik
trik install @scope/trik-name
\`\`\`

Triks come in two flavors:
- **Handoff triks** — take over the conversation for a specialized task (e.g. a coding assistant, a travel planner). Use \`/back\` to return.
- **Tool triks** — appear as native tools the agent can call (e.g. web search, calculator).

## Setup

\`\`\`bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -e .
cp .env.example .env
\`\`\`

Add your **${provider.envVar}** to \`.env\`.
`;

  if (hasTelegram) {
    readme += `
### Telegram Bot Token

To run the Telegram bot, you need a bot token:

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send \`/newbot\`
3. Choose a display name (e.g. "${config.name}")
4. Choose a username (must end in \`bot\`, e.g. \`${config.name.replace(/-/g, '_')}_bot\`)
5. Copy the token into \`.env\` as \`TELEGRAM_BOT_TOKEN\`
`;
  }

  readme += `
## Running

### CLI mode

\`\`\`bash
python cli.py
\`\`\`

Chat with your agent in the terminal. Type \`/back\` to return from a trik handoff, \`exit\` to quit.
`;

  if (hasTelegram) {
    readme += `
### Telegram mode

\`\`\`bash
python telegram_bot.py
\`\`\`

Your agent runs as a Telegram bot. Open Telegram, find your bot by username, and start chatting.

## Keeping your bot running

The Telegram bot needs to stay running to receive messages. Here are a few options:

### pm2 (Recommended)

\`\`\`bash
npm install -g pm2
pm2 start python --name "${config.name}" -- telegram_bot.py
pm2 save
pm2 startup  # auto-start on boot
\`\`\`

### Docker

\`\`\`dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml .
COPY *.py .
RUN pip install .
CMD ["python", "telegram_bot.py"]
\`\`\`

### systemd (Linux VPS)

\`\`\`ini
[Unit]
Description=${config.name} Telegram bot
After=network.target

[Service]
ExecStart=/home/user/${config.name}/.venv/bin/python /home/user/${config.name}/telegram_bot.py
WorkingDirectory=/home/user/${config.name}
Restart=always
EnvironmentFile=/home/user/${config.name}/.env

[Install]
WantedBy=multi-user.target
\`\`\`
`;
  }

  readme += `
## Installing triks

\`\`\`bash
trik install @scope/trik-name
\`\`\`

Installed triks are saved to \`.trikhub/config.json\` and loaded automatically when your agent starts.
`;

  return readme;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate a complete Python agent project ready to consume triks.
 *
 * @returns Map of { relativePath: fileContent } for all project files.
 */
export function generateAgentPythonProject(config: CreateAgentConfig): Record<string, string> {
  const files: Record<string, string> = {};

  files['pyproject.toml'] = generatePyprojectToml(config);
  files['.env.example'] = generateEnvExample(config);
  files['.gitignore'] = generateGitignore();
  files['.trikhub/config.json'] = generateTrikhubConfig();
  files['README.md'] = generateReadme(config);
  files['agent.py'] = generateAgentPy(config);
  files['cli.py'] = generateCliPy();

  if (config.channels === 'cli+telegram') {
    files['telegram_bot.py'] = generateTelegramPy();
  }

  return files;
}
