/**
 * TypeScript agent scaffold template.
 *
 * Generates a minimal agent project ready to consume triks via TrikGateway.
 * This is the counterpart to `trik init` — it scaffolds the consuming agent,
 * not a trik itself.
 */

// ============================================================================
// Types
// ============================================================================

export interface CreateAgentConfig {
  name: string;
  provider: 'openai' | 'anthropic' | 'google';
}

interface ProviderInfo {
  importPath: string;
  className: string;
  npmPackage: string;
  defaultModel: string;
  envVar: string;
}

const PROVIDERS: Record<string, ProviderInfo> = {
  openai: {
    importPath: '@langchain/openai',
    className: 'ChatOpenAI',
    npmPackage: '@langchain/openai',
    defaultModel: 'gpt-4o-mini',
    envVar: 'OPENAI_API_KEY',
  },
  anthropic: {
    importPath: '@langchain/anthropic',
    className: 'ChatAnthropic',
    npmPackage: '@langchain/anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    envVar: 'ANTHROPIC_API_KEY',
  },
  google: {
    importPath: '@langchain/google-genai',
    className: 'ChatGoogleGenerativeAI',
    npmPackage: '@langchain/google-genai',
    defaultModel: 'gemini-2.0-flash',
    envVar: 'GOOGLE_API_KEY',
  },
};

// ============================================================================
// File generators
// ============================================================================

function generatePackageJson(config: CreateAgentConfig): string {
  const provider = PROVIDERS[config.provider];
  const pkg = {
    name: config.name,
    version: '0.1.0',
    description: 'AI agent powered by TrikHub',
    type: 'module',
    scripts: {
      dev: 'node --import tsx src/cli.ts',
      build: 'tsc',
    },
    dependencies: {
      [provider.npmPackage]: '^1.0.0',
      '@langchain/core': '^1.0.0',
      '@langchain/langgraph': '^1.0.0',
      '@trikhub/gateway': 'latest',
      dotenv: '^16.4.0',
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
      declaration: true,
      sourceMap: true,
    },
    include: ['src/**/*'],
  };
  return JSON.stringify(tsconfig, null, 2);
}

function generateEnvExample(config: CreateAgentConfig): string {
  const provider = PROVIDERS[config.provider];
  return `${provider.envVar}=your-api-key-here\n`;
}

function generateGitignore(): string {
  return `node_modules/
dist/
*.tsbuildinfo
.env
`;
}

function generateTrikhubConfig(): string {
  return JSON.stringify({ triks: [] }, null, 2);
}

function generateAgentTs(config: CreateAgentConfig): string {
  const provider = PROVIDERS[config.provider];

  // Anthropic uses modelName, others use model
  const modelParam = config.provider === 'anthropic' ? 'modelName' : 'model';

  return `import { ${provider.className} } from '${provider.importPath}';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { TrikGateway } from '@trikhub/gateway';
import { enhance, getHandoffToolsForAgent, getExposedToolsForAgent } from '@trikhub/gateway/langchain';

const SYSTEM_PROMPT = \`You are a helpful assistant.
When a trik can handle the user's request, use the appropriate tool.\`;

export async function initializeAgent() {
  const model = new ${provider.className}({ ${modelParam}: '${provider.defaultModel}' });

  const gateway = new TrikGateway();
  await gateway.initialize();
  await gateway.loadTriksFromConfig();

  const handoffTools = getHandoffToolsForAgent(gateway);
  const exposedTools = getExposedToolsForAgent(gateway);

  const agent = createReactAgent({
    llm: model,
    tools: [...handoffTools, ...exposedTools] as any,
    messageModifier: SYSTEM_PROMPT,
  });

  const app = await enhance(agent as any, { gatewayInstance: gateway });

  return { app, handoffTools, exposedTools };
}
`;
}

function generateCliTs(): string {
  return `import 'dotenv/config';
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
  console.log('Loading agent...\\n');

  const { app, handoffTools, exposedTools } = await initializeAgent();

  if (handoffTools.length > 0) {
    console.log(\`Handoff triks: \${handoffTools.map((t) => t.name).join(', ')}\`);
  }
  if (exposedTools.length > 0) {
    console.log(\`Tool-mode triks: \${exposedTools.map((t) => t.name).join(', ')}\`);
  }
  console.log('Type "/back" to return from a trik handoff, "exit" to quit.\\n');

  const sessionId = \`cli-\${Date.now()}\`;

  while (true) {
    const userInput = await prompt('You: ');

    if (!userInput.trim()) continue;
    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log('\\nGoodbye!');
      break;
    }

    try {
      const result = await app.processMessage(userInput, sessionId);

      if (result.source === 'system') {
        console.log(\`\\n\\x1b[2m\${result.message}\\x1b[0m\\n\`);
      } else if (result.source !== 'main') {
        console.log(\`\\n[\${result.source}] \${result.message}\\n\`);
      } else {
        console.log(\`\\nAssistant: \${result.message}\\n\`);
      }
    } catch (error) {
      console.error('\\nError:', error);
      console.log('Please try again.\\n');
    }
  }

  rl.close();
}

main().catch((error) => {
  console.error(error);
  rl.close();
});
`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate a complete TypeScript agent project ready to consume triks.
 *
 * @returns Map of { relativePath: fileContent } for all project files.
 */
export function generateAgentTypescriptProject(config: CreateAgentConfig): Record<string, string> {
  const files: Record<string, string> = {};

  files['package.json'] = generatePackageJson(config);
  files['tsconfig.json'] = generateTsConfig();
  files['.env.example'] = generateEnvExample(config);
  files['.gitignore'] = generateGitignore();
  files['.trikhub/config.json'] = generateTrikhubConfig();
  files['src/agent.ts'] = generateAgentTs(config);
  files['src/cli.ts'] = generateCliTs();

  return files;
}
