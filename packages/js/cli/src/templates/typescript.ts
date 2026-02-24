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
  agentMode: 'conversational' | 'tool';
  handoffDescription: string;
  domainTags: string[];
  toolNames: string[];
}

// ============================================================================
// File generators
// ============================================================================

function generateManifest(config: InitConfig): string {
  const isToolMode = config.agentMode === 'tool';

  const agent: Record<string, unknown> = {
    mode: config.agentMode,
    domain: config.domainTags,
  };

  if (!isToolMode) {
    agent.handoffDescription = config.handoffDescription;
    agent.systemPromptFile = './src/prompts/system.md';
    agent.model = { capabilities: ['tool_use'] };
  }

  const manifest: Record<string, unknown> = {
    schemaVersion: 2,
    id: config.name,
    name: config.displayName,
    description: config.description,
    version: '0.1.0',
    agent,
  };

  // Tools block
  if (isToolMode && config.toolNames.length > 0) {
    const tools: Record<string, Record<string, unknown>> = {};
    for (const toolName of config.toolNames) {
      tools[toolName] = {
        description: `TODO: describe ${toolName}`,
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', maxLength: 200 },
          },
          required: ['query'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            result: { type: 'string', maxLength: 500 },
          },
          required: ['result'],
        },
      };
    }
    manifest.tools = tools;
  } else {
    manifest.tools = {
      exampleTool: {
        description: 'An example tool',
      },
    };
  }

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
  const isToolMode = config.agentMode === 'tool';

  const dependencies: Record<string, string> = {
    '@trikhub/sdk': 'latest',
  };

  // Conversational mode needs LangChain + LLM provider
  if (!isToolMode) {
    dependencies['@langchain/anthropic'] = '^0.3.0';
    dependencies['@langchain/core'] = '^0.3.0';
    dependencies['@langchain/langgraph'] = '^0.2.0';
    dependencies['zod'] = '^3.25.0';
  }

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
    dependencies,
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

function generateToolModeAgentTs(config: InitConfig): string {
  const handlers = config.toolNames.map((name) =>
    `  ${name}: async (input, context) => {
    // TODO: Implement ${name}
    return { result: 'Not implemented' };
  },`
  ).join('\n');

  return `/**
 * ${config.displayName} — tool-mode agent entry point.
 *
 * Exports native tools to the main agent. No handoff, no session.
 */

import { wrapToolHandlers } from '@trikhub/sdk';

export default wrapToolHandlers({
${handlers}
});
`;
}

function generateAgentTs(config: InitConfig): string {
  if (config.agentMode === 'tool') {
    return generateToolModeAgentTs(config);
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
  const isToolMode = config.agentMode === 'tool';

  const devSection = isToolMode
    ? `- Implement your tool handlers in \`src/agent.ts\`
- Update inputSchema/outputSchema in \`manifest.json\``
    : `- Edit your agent logic in \`src/agent.ts\`
- Add tools in \`src/tools/\`
- Customize the system prompt in \`src/prompts/system.md\``;

  const archSection = isToolMode
    ? `Tools from this trik appear as native tools on the main agent — no handoff, no session.`
    : `The main agent routes conversations to this trik using a \`talk_to_${config.name}\` tool.
When done, use the \`transfer_back\` tool to return control.`;

  return `# ${config.displayName}

${config.description}

## Getting Started

1. Install dependencies: \`npm install\`
2. Build: \`npm run build\`
3. Validate: \`trik lint .\`
4. Publish: \`trik publish\`

## Development

${devSection}

## Architecture

This trik uses the TrikHub v2 architecture:
- **Mode**: ${config.agentMode}
- **Domain**: ${domainStr}

${archSection}
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

  if (config.agentMode === 'conversational') {
    // Conversational mode: example tool + system prompt
    files['src/tools/example.ts'] = generateExampleTool();
    files['src/prompts/system.md'] = generateSystemPrompt(config);
  }
  // Tool mode: no separate tool files or system prompt — all logic in agent.ts

  return files;
}
