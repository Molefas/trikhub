/**
 * TypeScript Trik Template Generator
 *
 * Generates all files needed for a TypeScript trik project.
 */

import { TrikCategory } from '../types.js';

export interface TsTemplateConfig {
  name: string;
  displayName: string;
  description: string;
  authorName: string;
  authorGithub: string;
  category: TrikCategory;
  enableStorage: boolean;
  enableConfig: boolean;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

/**
 * Generate all files for a TypeScript trik project
 */
export function generateTypescriptProject(config: TsTemplateConfig): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  files.push({ path: 'manifest.json', content: generateManifest(config) });
  files.push({ path: 'trikhub.json', content: generateTrikhubJson(config) });
  files.push({ path: 'package.json', content: generatePackageJson(config) });
  files.push({ path: 'tsconfig.json', content: generateTsConfig() });
  files.push({ path: 'src/index.ts', content: generateIndexTs(config) });
  files.push({ path: 'test.ts', content: generateTestTs() });
  files.push({ path: 'README.md', content: generateReadme(config) });
  files.push({ path: '.gitignore', content: generateGitignore() });

  return files;
}

function generateManifest(config: TsTemplateConfig): string {
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    id: config.name,
    name: config.displayName,
    description: config.description,
    version: '0.1.0',
    actions: {
      hello: {
        description: 'Say hello to someone',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name to greet' },
          },
          required: ['name'],
        },
        responseMode: 'template',
        agentDataSchema: {
          type: 'object',
          properties: {
            template: { type: 'string', enum: ['success'] },
            greeting: { type: 'string', maxLength: 200, pattern: '^.{1,200}$' },
          },
          required: ['template', 'greeting'],
        },
        responseTemplates: {
          success: { text: '{{greeting}}' },
        },
      },
    },
    capabilities: {
      tools: [],
    },
    limits: {
      maxExecutionTimeMs: 5000,
    },
    entry: {
      module: './dist/index.js',
      export: 'default',
    },
  };

  // Add storage capability if enabled
  if (config.enableStorage) {
    (manifest.capabilities as Record<string, unknown>).storage = {
      enabled: true,
      maxSizeBytes: 1048576,
      persistent: true,
    };
  }

  // Add config if enabled
  if (config.enableConfig) {
    manifest.config = {
      required: [
        { key: 'API_KEY', description: 'Your API key' },
      ],
      optional: [],
    };
  }

  return JSON.stringify(manifest, null, 2) + '\n';
}

function generateTrikhubJson(config: TsTemplateConfig): string {
  const trikhub = {
    displayName: config.displayName,
    shortDescription: config.description,
    categories: [config.category],
    keywords: [config.name],
    author: {
      name: config.authorName,
      github: config.authorGithub,
    },
    repository: `https://github.com/${config.authorGithub}/${config.name}`,
  };

  return JSON.stringify(trikhub, null, 2) + '\n';
}

function generatePackageJson(config: TsTemplateConfig): string {
  const pkg = {
    name: `@${config.authorGithub.toLowerCase()}/${config.name}`,
    version: '0.1.0',
    description: config.description,
    type: 'module',
    main: 'dist/index.js',
    scripts: {
      build: 'tsc',
      clean: 'rm -rf dist',
      test: 'npm run build && tsx test.ts',
    },
    dependencies: {
      '@trikhub/manifest': '^0.7.0',
    },
    devDependencies: {
      '@types/node': '^20.0.0',
      tsx: '^4.0.0',
      typescript: '^5.6.0',
    },
    engines: {
      node: '>=20',
    },
  };

  return JSON.stringify(pkg, null, 2) + '\n';
}

function generateTsConfig(): string {
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      declaration: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  };

  return JSON.stringify(tsconfig, null, 2) + '\n';
}

function generateIndexTs(config: TsTemplateConfig): string {
  const storageImport = config.enableStorage
    ? `
interface Storage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
`
    : '';

  const configType = config.enableConfig
    ? `
interface Config {
  API_KEY: string;
}
`
    : '';

  const invokeParams = [
    'action: string',
    'input: Record<string, unknown>',
    config.enableStorage ? 'storage?: Storage' : null,
    config.enableConfig ? 'config?: Config' : null,
  ]
    .filter(Boolean)
    .join('; ');

  return `/**
 * ${config.displayName}
 *
 * ${config.description}
 */

type InvokeInput = {
  ${invokeParams};
};

type InvokeResult = {
  responseMode: 'template' | 'passthrough';
  agentData?: Record<string, unknown>;
  userContent?: Record<string, unknown>;
};
${storageImport}${configType}
class ${toPascalCase(config.name)}Graph {
  async invoke(input: InvokeInput): Promise<InvokeResult> {
    const { action, input: actionInput } = input;

    if (action === 'hello') {
      const name = (actionInput.name as string) || 'World';
      return {
        responseMode: 'template',
        agentData: {
          template: 'success',
          greeting: \`Hello, \${name}!\`,
        },
      };
    }

    return {
      responseMode: 'template',
      agentData: {
        template: 'error',
        message: \`Unknown action: \${action}\`,
      },
    };
  }
}

export default new ${toPascalCase(config.name)}Graph();
`;
}

function generateTestTs(): string {
  return `/**
 * Local test script
 *
 * Run with: npm test
 */

import graph from './src/index.js';

async function main() {
  const result = await graph.invoke({
    action: 'hello',
    input: { name: 'World' },
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
`;
}

function generateReadme(config: TsTemplateConfig): string {
  return `# ${config.displayName}

${config.description}

## Development

\`\`\`bash
npm install
npm run build
npm test
\`\`\`

## Actions

### hello

Say hello to someone.

**Input:**
- \`name\` (string, required): Name to greet

## Publishing

\`\`\`bash
trik publish
\`\`\`
`;
}

function generateGitignore(): string {
  return `node_modules/
*.log
.DS_Store
`;
}

function toPascalCase(str: string): string {
  return str
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
