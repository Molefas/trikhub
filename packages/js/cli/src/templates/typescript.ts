/**
 * v2 TypeScript scaffold template.
 *
 * Generates a complete v2 trik project structure using the
 * agent-based handoff architecture with wrapAgent() from @trikhub/sdk.
 */

// ============================================================================
// Types
// ============================================================================

export interface InitConfig {
  name: string;
  displayName: string;
  description: string;
  authorName: string;
  authorGithub: string;
  category: string;
  enableStorage: boolean;
  enableConfig: boolean;
  // v2 fields
  agentMode: 'conversational' | 'one-shot';
  handoffDescription: string;
  domainTags: string[];
}

// ============================================================================
// File generators
// ============================================================================

function generateManifest(config: InitConfig): string {
  const manifest: Record<string, unknown> = {
    schemaVersion: 2,
    id: config.name,
    name: config.displayName,
    description: config.description,
    version: '0.1.0',
    agent: {
      mode: config.agentMode,
      handoffDescription: config.handoffDescription,
      ...(config.agentMode === 'conversational'
        ? { systemPromptFile: './src/prompts/system.md' }
        : {}),
      ...(config.agentMode === 'conversational'
        ? { model: { capabilities: ['tool_use'] } }
        : {}),
      domain: config.domainTags,
    },
    tools: {
      exampleTool: {
        description: 'An example tool',
      },
    },
  };

  if (config.enableStorage) {
    manifest.capabilities = {
      storage: { enabled: true },
    };
  }

  manifest.limits = { maxTurnTimeMs: 30000 };
  manifest.entry = {
    module: './dist/agent.js',
    export: 'default',
  };
  manifest.author = config.authorName;

  if (config.enableConfig) {
    manifest.config = {
      optional: [
        { key: 'ANTHROPIC_API_KEY', description: 'Anthropic API key for the agent' },
      ],
    };
  }

  return JSON.stringify(manifest, null, 2);
}

function generateTrikhubJson(config: InitConfig): string {
  const metadata = {
    displayName: config.displayName,
    shortDescription: config.description,
    categories: [config.category],
    keywords: [] as string[],
    author: {
      name: config.authorName,
      github: config.authorGithub,
    },
    repository: `https://github.com/${config.authorGithub}/${config.name}`,
  };

  return JSON.stringify(metadata, null, 2);
}

function generatePackageJson(config: InitConfig): string {
  const pkg = {
    name: config.name,
    version: '0.1.0',
    description: config.description,
    type: 'module',
    main: './dist/agent.js',
    scripts: {
      build: 'tsc',
      dev: 'node --import tsx src/agent.ts',
      clean: 'rm -rf dist *.tsbuildinfo',
    },
    dependencies: {
      '@trikhub/sdk': 'latest',
      '@langchain/anthropic': '^0.3.0',
      '@langchain/core': '^0.3.0',
      '@langchain/langgraph': '^0.2.0',
      zod: '^3.25.0',
    },
    devDependencies: {
      tsx: '^4.19.0',
      typescript: '^5.7.0',
    },
  };

  return JSON.stringify(pkg, null, 2);
}

function generateTsConfig(): string {
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'nodenext',
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
    },
    include: ['src/**/*'],
  };

  return JSON.stringify(tsconfig, null, 2);
}

function generateAgentTs(config: InitConfig): string {
  if (config.agentMode === 'one-shot') {
    return `/**
 * ${config.displayName} — one-shot agent entry point.
 */

import { wrapAgent, transferBackTool } from '@trikhub/sdk';
import type { TrikContext } from '@trikhub/sdk';
import { exampleTool } from './tools/example.js';

export default wrapAgent((context: TrikContext) => {
  // One-shot mode: process the request and transfer back immediately.
  // The agent will call tools as needed, then transfer_back with a summary.

  const tools = [
    exampleTool,
    transferBackTool,
  ];

  // TODO: Replace with your one-shot processing logic
  // For one-shot mode, consider using a simple function instead of a full LLM agent
  throw new Error('Not implemented — replace with your processing logic');
});
`;
  }

  // Conversational mode
  return `/**
 * ${config.displayName} — conversational agent entry point.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { wrapAgent, transferBackTool } from '@trikhub/sdk';
import type { TrikContext } from '@trikhub/sdk';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exampleTool } from './tools/example.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(join(__dirname, '../src/prompts/system.md'), 'utf-8');

export default wrapAgent((context: TrikContext) => {
  const model = new ChatAnthropic({
    modelName: 'claude-sonnet-4-20250514',
    anthropicApiKey: ${config.enableConfig ? "config.get('ANTHROPIC_API_KEY')" : 'process.env.ANTHROPIC_API_KEY'},
  });

  const tools = [
    exampleTool,
    transferBackTool,
  ];

  return createReactAgent({
    llm: model,
    tools,
    messageModifier: systemPrompt,
  });
});
`;
}

function generateExampleTool(): string {
  return `import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const exampleTool = tool(
  async (input) => {
    // TODO: Implement your tool logic here
    return JSON.stringify({ result: \`Processed: \${input.query}\` });
  },
  {
    name: 'exampleTool',
    description: 'An example tool — replace with your own implementation',
    schema: z.object({
      query: z.string().describe('The input query to process'),
    }),
  },
);
`;
}

function generateSystemPrompt(config: InitConfig): string {
  const domainStr = config.domainTags.join(', ');

  return `# ${config.displayName}

You are ${config.displayName}, a specialized assistant for ${config.description.toLowerCase()}.

## Your capabilities
- **exampleTool**: An example tool

## Guidelines
- Focus on tasks within your domain: ${domainStr}
- When the user's request is outside your expertise, use the transfer_back tool
- Provide clear, actionable responses

## Transfer back
Use the \`transfer_back\` tool when:
- The user's request is outside your domain
- You've completed the task and the user wants to do something else
- The user explicitly asks to go back
`;
}

function generateGitignore(): string {
  return `node_modules/
dist/
*.tsbuildinfo
.env
.trikhub/secrets.json
`;
}

function generateReadme(config: InitConfig): string {
  const domainStr = config.domainTags.join(', ');

  return `# ${config.displayName}

${config.description}

## Getting Started

1. Install dependencies: \`npm install\`
2. Build: \`npm run build\`
3. Validate: \`trik lint .\`
4. Publish: \`trik publish\`

## Development

- Edit your agent logic in \`src/agent.ts\`
- Add tools in \`src/tools/\`
${config.agentMode === 'conversational' ? '- Customize the system prompt in `src/prompts/system.md`\n' : ''}
## Architecture

This trik uses the TrikHub v2 handoff architecture:
- **Mode**: ${config.agentMode}
- **Domain**: ${domainStr}

The main agent routes conversations to this trik using a \`talk_to_${config.name}\` tool.
When done, use the \`transfer_back\` tool to return control.
`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate a complete v2 TypeScript trik project.
 *
 * @returns Map of { relativePath: fileContent } for all project files.
 */
export function generateTypescriptProject(config: InitConfig): Record<string, string> {
  const files: Record<string, string> = {};

  // Core config files
  files['manifest.json'] = generateManifest(config);
  files['trikhub.json'] = generateTrikhubJson(config);
  files['package.json'] = generatePackageJson(config);
  files['tsconfig.json'] = generateTsConfig();
  files['.gitignore'] = generateGitignore();
  files['README.md'] = generateReadme(config);

  // Source files
  files['src/agent.ts'] = generateAgentTs(config);
  files['src/tools/example.ts'] = generateExampleTool();

  // System prompt (conversational mode only)
  if (config.agentMode === 'conversational') {
    files['src/prompts/system.md'] = generateSystemPrompt(config);
  }

  return files;
}
