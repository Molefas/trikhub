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
  channels?: 'cli' | 'cli+telegram';
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
  const hasTelegram = config.channels === 'cli+telegram';

  const scripts: Record<string, string> = {
    dev: 'node --import tsx src/cli.ts',
    build: 'tsc',
  };
  if (hasTelegram) {
    scripts.telegram = 'node --import tsx src/telegram.ts';
  }

  const dependencies: Record<string, string> = {
    [provider.npmPackage]: '^1.0.0',
    '@langchain/core': '^1.0.0',
    '@langchain/langgraph': '^1.0.0',
    '@trikhub/gateway': 'latest',
    dotenv: '^16.4.0',
  };
  if (hasTelegram) {
    dependencies.grammy = '^1.0.0';
  }

  const pkg = {
    name: config.name,
    version: '0.1.0',
    description: 'AI agent powered by TrikHub',
    type: 'module',
    scripts,
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
      declaration: true,
      sourceMap: true,
    },
    include: ['src/**/*'],
  };
  return JSON.stringify(tsconfig, null, 2);
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
import { enhance } from '@trikhub/gateway/langchain';

const SYSTEM_PROMPT = \`You are a helpful agent spawned by Trikhub. A user has installed you and you are ready to install Triks to help them with various tasks. You can call any tools provided by the installed Triks to assist the user.
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

When a trik can handle the user's request, use the appropriate tool.\`;

export async function initializeAgent() {
  const model = new ${provider.className}({ ${modelParam}: '${provider.defaultModel}' });

  const app = await enhance(null, {
    createAgent: (trikTools) =>
      createReactAgent({
        llm: model,
        tools: [...trikTools] as any,
        messageModifier: SYSTEM_PROMPT,
      }),
  });

  return app;
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

  const app = await initializeAgent();

  const loadedTriks = app.getLoadedTriks();
  if (loadedTriks.length > 0) {
    console.log(\`Loaded triks: \${loadedTriks.join(', ')}\`);
  }
  console.log('Tip: Ask the Agent how this works or what to do next!\\n');

  const sessionId = \`cli-\${Date.now()}\`;

  while (true) {
    const userInput = await prompt('> ');

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

function generateTelegramTs(): string {
  return `import 'dotenv/config';
import { Bot } from 'grammy';
import { initializeAgent } from './agent.js';

async function main() {
  console.log('Loading agent...\\n');

  const app = await initializeAgent();

  const loadedTriks = app.getLoadedTriks();
  if (loadedTriks.length > 0) {
    console.log(\`Loaded triks: \${loadedTriks.join(', ')}\`);
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set in .env');
    process.exit(1);
  }

  const bot = new Bot(token);
  const sessionId = \`telegram-\${Date.now()}\`;

  bot.on('message:text', async (ctx) => {
    try {
      const result = await app.processMessage(ctx.message.text, sessionId);
      await ctx.reply(result.message);
    } catch (error) {
      console.error('Error processing message:', error);
      await ctx.reply('Something went wrong. Please try again.');
    }
  });

  bot.catch((err) => {
    console.error('Bot error:', err);
  });

  console.log('\\nTelegram bot started! Send a message to your bot.\\n');
  bot.start();
}

main().catch(console.error);
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
npm run dev
\`\`\`

Chat with your agent in the terminal. Type \`/back\` to return from a trik handoff, \`exit\` to quit.
`;

  if (hasTelegram) {
    readme += `
### Telegram mode

\`\`\`bash
npm run telegram
\`\`\`

Your agent runs as a Telegram bot. Open Telegram, find your bot by username, and start chatting.

## Keeping your bot running

The Telegram bot needs to stay running to receive messages. Here are a few options:

### pm2 (Recommended)

\`\`\`bash
npm install -g pm2
pm2 start npm --name "${config.name}" -- run telegram
pm2 save
pm2 startup  # auto-start on boot
\`\`\`

### Docker

\`\`\`dockerfile
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --production
COPY . .
RUN npm run build
CMD ["node", "dist/telegram.js"]
\`\`\`

### systemd (Linux VPS)

\`\`\`ini
[Unit]
Description=${config.name} Telegram bot
After=network.target

[Service]
ExecStart=/usr/bin/node /home/user/${config.name}/dist/telegram.js
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
  files['README.md'] = generateReadme(config);
  files['src/agent.ts'] = generateAgentTs(config);
  files['src/cli.ts'] = generateCliTs();

  if (config.channels === 'cli+telegram') {
    files['src/telegram.ts'] = generateTelegramTs();
  }

  return files;
}
