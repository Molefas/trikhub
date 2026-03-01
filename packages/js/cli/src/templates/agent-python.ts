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
    "python-dotenv>=1.0.0",
]
`;
}

function generateEnvExample(config: CreateAgentConfig): string {
  const provider = PROVIDERS[config.provider];
  return `${provider.envVar}=your-api-key-here\n`;
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

from trikhub.gateway import TrikGateway
from trikhub.langchain import enhance, get_handoff_tools_for_agent, get_exposed_tools_for_agent

SYSTEM_PROMPT = """You are a helpful assistant.
When a trik can handle the user's request, use the appropriate tool."""


async def initialize_agent():
    model = ${provider.className}(model="${provider.defaultModel}")

    gateway = TrikGateway()
    await gateway.initialize()
    await gateway.load_triks_from_config()

    handoff_tools = get_handoff_tools_for_agent(gateway)
    exposed_tools = get_exposed_tools_for_agent(gateway)

    agent = create_react_agent(
        model=model,
        tools=[*handoff_tools, *exposed_tools],
        prompt=SYSTEM_PROMPT,
    )

    app = await enhance(agent, gateway_instance=gateway)

    return app, handoff_tools, exposed_tools
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

    app, handoff_tools, exposed_tools = await initialize_agent()

    if handoff_tools:
        print(f"Handoff triks: {', '.join(t.name for t in handoff_tools)}")
    if exposed_tools:
        print(f"Tool-mode triks: {', '.join(t.name for t in exposed_tools)}")
    print('Type "/back" to return from a trik handoff, "exit" to quit.\\n')

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
  files['agent.py'] = generateAgentPy(config);
  files['cli.py'] = generateCliPy();

  return files;
}
