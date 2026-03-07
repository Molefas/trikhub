"""TypeScript Agent Template Generator.

Generates a minimal TypeScript agent project ready to consume triks
via TrikGateway. Counterpart to trik init — scaffolds the consuming
agent, not a trik itself.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


@dataclass
class CreateAgentConfig:
    name: str
    provider: str  # 'openai' | 'anthropic' | 'google'


@dataclass
class GeneratedFile:
    path: str
    content: str


_PROVIDERS: dict[str, dict[str, str]] = {
    "openai": {
        "importPath": "@langchain/openai",
        "className": "ChatOpenAI",
        "npmPackage": "@langchain/openai",
        "defaultModel": "gpt-4o-mini",
        "envVar": "OPENAI_API_KEY",
        "modelParam": "model",
    },
    "anthropic": {
        "importPath": "@langchain/anthropic",
        "className": "ChatAnthropic",
        "npmPackage": "@langchain/anthropic",
        "defaultModel": "claude-sonnet-4-20250514",
        "envVar": "ANTHROPIC_API_KEY",
        "modelParam": "modelName",
    },
    "google": {
        "importPath": "@langchain/google-genai",
        "className": "ChatGoogleGenerativeAI",
        "npmPackage": "@langchain/google-genai",
        "defaultModel": "gemini-2.0-flash",
        "envVar": "GOOGLE_API_KEY",
        "modelParam": "model",
    },
}


def generate_agent_typescript_project(config: CreateAgentConfig) -> list[GeneratedFile]:
    files: list[GeneratedFile] = []
    provider = _PROVIDERS[config.provider]

    files.append(GeneratedFile("package.json", _generate_package_json(config, provider)))
    files.append(GeneratedFile("tsconfig.json", _generate_tsconfig()))
    files.append(GeneratedFile(".env.example", f"{provider['envVar']}=your-api-key-here\n"))
    files.append(GeneratedFile(".gitignore", _generate_gitignore()))
    files.append(GeneratedFile(".trikhub/config.json", json.dumps({"triks": []}, indent=2)))
    files.append(GeneratedFile("src/agent.ts", _generate_agent_ts(config, provider)))
    files.append(GeneratedFile("src/cli.ts", _generate_cli_ts()))

    return files


def _generate_package_json(config: CreateAgentConfig, provider: dict[str, str]) -> str:
    pkg: dict[str, Any] = {
        "name": config.name,
        "version": "0.1.0",
        "description": "AI agent powered by TrikHub",
        "type": "module",
        "scripts": {
            "dev": "node --import tsx src/cli.ts",
            "build": "tsc",
        },
        "dependencies": {
            provider["npmPackage"]: "^1.0.0",
            "@langchain/core": "^1.0.0",
            "@langchain/langgraph": "^1.0.0",
            "@trikhub/gateway": "latest",
            "dotenv": "^16.4.0",
        },
        "devDependencies": {
            "tsx": "^4.19.0",
            "typescript": "^5.7.0",
        },
    }
    return json.dumps(pkg, indent=2)


def _generate_tsconfig() -> str:
    tsconfig = {
        "compilerOptions": {
            "target": "ES2022",
            "module": "NodeNext",
            "moduleResolution": "nodenext",
            "outDir": "./dist",
            "rootDir": "./src",
            "strict": True,
            "esModuleInterop": True,
            "skipLibCheck": True,
            "declaration": True,
            "sourceMap": True,
        },
        "include": ["src/**/*"],
    }
    return json.dumps(tsconfig, indent=2)


def _generate_gitignore() -> str:
    return """node_modules/
dist/
*.tsbuildinfo
.env
"""


def _generate_agent_ts(config: CreateAgentConfig, provider: dict[str, str]) -> str:
    return f"""import {{ {provider['className']} }} from '{provider['importPath']}';
import {{ createReactAgent }} from '@langchain/langgraph/prebuilt';
import {{ enhance }} from '@trikhub/gateway/langchain';

const SYSTEM_PROMPT = `You are a helpful agent spawned by Trikhub. A user has installed you and you are ready to install Triks to help them with various tasks. You can call any tools provided by the installed Triks to assist the user.
How this works:
Trikhub is above everything a Tool & Agent orchestration framework. Each Tool and Agent are black boxes, only connected by a main agent - This is what you are and the user just installed.
From here on the user will be able to install Triks (these Agents and Tools) that will be available through you, the main LLM. You have capabilities to call these tools and agents to assist the user, but you don't have access to what they are until the user installs them. So your first task is to guide the user to install some useful Triks for you to use.
It's important that users know that they can, voncersationally, use whichever tool or agent they need, but only one at the same time. They can go back & forward as they see fit.

First triks:
Feel free to propose a few starting Triks that the user should use to test out your capabilitites:
- @molefas/trikster: The first Trik anyone should have. This allows you to install other Triks without needing to close or refresh this session and you'll be able to isntall them directly through chat.
- @molefas/site-builder: A Demo Trik for building websites. It's meant to showcase how Triks can generate files and execute commands in a safe environment (docker container). With this Trik, you can build a static website by describing it to the agent, which will generate the necessary HTML/CSS/JS files and even run a local server for you to preview it.
- @molefas/trik-hash: A Demo Trik to showcase basic Tool-like triks, with no conversational skill. It provides a simple hashing tool that can hash any input with various algorithms (md5, sha256, etc). It's a great starting point to understand how to call tools from your agent.
- @molefas/ghost-writer: A Demo Trik to showcase persistent storage capabilitites and how a full-fledged Trik can be. It also exposes a web interface for users to interact with their data.

Other useful tips:
- Users can do trik list to see installed triks and trik search <query> to find new ones.
- Users can refer to the Trikhub documentation at https://docs.trikhub.com for more details on how to use and create triks.
- If you've chosen the Telegram installation, check the readme for instructions on how to interact with your agent via Telegram.

When a trik can handle the user's request, use the appropriate tool.`;

export async function initializeAgent() {{
  const model = new {provider['className']}({{ {provider['modelParam']}: '{provider['defaultModel']}' }});

  const app = await enhance(null, {{
    createAgent: (trikTools) =>
      createReactAgent({{
        llm: model,
        tools: [...trikTools] as any,
        messageModifier: SYSTEM_PROMPT,
      }}),
  }});

  return app;
}}
"""


def _generate_cli_ts() -> str:
    return r"""import 'dotenv/config';
import * as readline from 'readline';
import { initializeAgent } from './agent.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function main() {
  console.log('Loading agent...\n');

  const app = await initializeAgent();

  // Subscribe to gateway events for real-time status feedback
  app.gateway.on('handoff:start', ({ trikName }: { trikName: string }) => {
    process.stdout.write(`\x1b[2m[${trikName}] Connecting...\x1b[0m\n`);
  });
  app.gateway.on('handoff:container_start', ({ trikName }: { trikName: string }) => {
    process.stdout.write(`\x1b[2m[${trikName}] Starting container...\x1b[0m\n`);
  });
  app.gateway.on('handoff:thinking', ({ trikName }: { trikName: string }) => {
    process.stdout.write(`\x1b[2m[${trikName}] Thinking...\x1b[0m\n`);
  });
  app.gateway.on('handoff:error', ({ trikName, error }: { trikName: string; error: string }) => {
    process.stdout.write(`\x1b[31m[${trikName}] Error: ${error}\x1b[0m\n`);
  });
  app.gateway.on('handoff:transfer_back', ({ trikName, reason }: { trikName: string; reason: string }) => {
    process.stdout.write(`\x1b[2m[${trikName}] Transferred back (${reason})\x1b[0m\n`);
  });

  const loadedTriks = app.getLoadedTriks();
  if (loadedTriks.length > 0) {
    console.log(`Loaded triks: ${loadedTriks.join(', ')}`);
  }
  console.log('Type "/back" to return from a trik handoff, "exit" to quit.');
  console.log('Tip: Ask the Agent what to do next\n');

  const sessionId = `cli-${Date.now()}`;

  while (true) {
    const userInput = await prompt('You: ');

    if (!userInput.trim()) continue;
    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log('\nGoodbye!');
      break;
    }

    try {
      const result = await app.processMessage(userInput, sessionId);

      if (result.source === 'system') {
        console.log(`\n\x1b[2m${result.message}\x1b[0m\n`);
      } else if (result.source !== 'main') {
        console.log(`\n[${result.source}] ${result.message}\n`);
      } else {
        console.log(`\nAssistant: ${result.message}\n`);
      }
    } catch (error) {
      console.error('\nError:', error);
      console.log('Please try again.\n');
    }
  }

  rl.close();
}

main().catch((error) => {
  console.error(error);
  rl.close();
});
"""
