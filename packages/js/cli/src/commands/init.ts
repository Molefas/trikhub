/**
 * trik init command
 *
 * Scaffolds a new trik project with boilerplate code.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { input, select, confirm } from '@inquirer/prompts';
import { TrikCategory } from '../types.js';
import { loadDefaults, saveDefaults } from '../lib/storage.js';
import { generateTypescriptProject } from '../templates/typescript.js';
import type { InitConfig } from '../templates/typescript.js';

type Language = 'ts' | 'py';

const CATEGORIES: { value: TrikCategory; label: string }[] = [
  { value: 'utilities', label: 'Utilities' },
  { value: 'productivity', label: 'Productivity' },
  { value: 'developer', label: 'Developer Tools' },
  { value: 'data', label: 'Data & Analytics' },
  { value: 'search', label: 'Search' },
  { value: 'content', label: 'Content' },
  { value: 'communication', label: 'Communication' },
  { value: 'finance', label: 'Finance' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'education', label: 'Education' },
  { value: 'other', label: 'Other' },
];

/**
 * Validate trik name
 * - lowercase, 2-50 chars, starts with letter, alphanumeric + dashes only
 */
function validateTrikName(name: string): string | true {
  if (name.length < 2 || name.length > 50) {
    return 'Name must be 2-50 characters';
  }
  if (!/^[a-z]/.test(name)) {
    return 'Name must start with a letter';
  }
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return 'Name must be lowercase, alphanumeric + dashes only';
  }
  return true;
}

/**
 * Parse and normalize language argument
 */
function parseLanguage(lang: string): Language | null {
  const normalized = lang.toLowerCase();
  if (normalized === 'ts' || normalized === 'typescript') {
    return 'ts';
  }
  if (normalized === 'py' || normalized === 'python') {
    return 'py';
  }
  return null;
}

export async function initCommand(languageArg: string): Promise<void> {
  const spinner = ora();

  try {
    // Validate language
    const language = parseLanguage(languageArg);
    if (!language) {
      console.log(chalk.red(`Invalid language: ${languageArg}`));
      console.log(chalk.dim('Supported languages: ts (TypeScript) or py (Python)'));
      process.exit(1);
    }

    console.log();
    console.log(chalk.bold('  Create a new Trik'));
    console.log();

    // Load saved defaults
    const defaults = loadDefaults();

    // Interactive prompts
    const name = await input({
      message: 'Trik name:',
      default: 'my-trik',
      validate: validateTrikName,
      transformer: (value) => value.toLowerCase(),
    });

    const displayName = await input({
      message: 'Display name:',
      default: name
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
    });

    const description = await input({
      message: 'Short description:',
      default: 'A short description',
    });

    const authorName = await input({
      message: 'Author name:',
      default: defaults.authorName || '',
    });

    const authorGithub = await input({
      message: 'GitHub username:',
      default: defaults.authorGithub || '',
    });

    const category = await select<TrikCategory>({
      message: 'Category:',
      choices: CATEGORIES.map((c) => ({ value: c.value, name: c.label })),
      default: 'utilities',
    });

    const enableStorage = await confirm({
      message: 'Enable persistent storage?',
      default: false,
    });

    const enableConfig = await confirm({
      message: 'Enable configuration (env vars)?',
      default: false,
    });

    // v2 agent prompts
    const agentMode = await select<'conversational' | 'tool'>({
      message: 'Agent mode:',
      choices: [
        { value: 'conversational', name: 'Conversational (multi-turn ReAct agent)' },
        { value: 'tool', name: 'Tool (export native tools to main agent)' },
      ],
      default: 'conversational',
    });

    // Handoff description only for conversational mode
    let handoffDescription = '';
    if (agentMode === 'conversational') {
      handoffDescription = await input({
        message: 'Handoff description (how should the main agent describe this trik?):',
        validate: (value: string) => {
          if (value.length < 10) return 'Description must be at least 10 characters';
          if (value.length > 500) return 'Description must be at most 500 characters';
          return true;
        },
      });
    }

    // Tool names for tool mode
    let toolNames: string[] = [];
    if (agentMode === 'tool') {
      const toolNamesRaw = await input({
        message: 'Tool names (comma-separated, camelCase, e.g. "getWeather, getForecast"):',
        validate: (value: string) => {
          const names = value.split(',').map((t) => t.trim()).filter(Boolean);
          if (names.length === 0) return 'At least one tool name is required';
          for (const n of names) {
            if (!/^[a-z][a-zA-Z0-9]*$/.test(n)) {
              return `Invalid tool name "${n}": must be camelCase starting with a lowercase letter`;
            }
          }
          return true;
        },
      });
      toolNames = toolNamesRaw.split(',').map((t) => t.trim()).filter(Boolean);
    }

    const domainTagsRaw = await input({
      message: 'Domain tags (comma-separated, e.g. "content curation, article writing"):',
      validate: (value: string) => {
        const tags = value.split(',').map((t) => t.trim()).filter(Boolean);
        if (tags.length === 0) return 'At least one domain tag is required';
        return true;
      },
    });

    const domainTags = domainTagsRaw.split(',').map((t) => t.trim()).filter(Boolean);

    // Path selection
    const pathChoice = await select<'current' | 'other'>({
      message: 'Where to create the trik?',
      choices: [
        { value: 'current', name: `Current folder (./${name})` },
        { value: 'other', name: 'Other location...' },
      ],
    });

    let targetDir: string;
    if (pathChoice === 'current') {
      targetDir = resolve(process.cwd(), name);
    } else {
      const customPath = await input({
        message: 'Enter path:',
        default: `./${name}`,
      });
      targetDir = resolve(process.cwd(), customPath);
    }

    // Check if directory exists
    if (existsSync(targetDir)) {
      console.log();
      console.log(chalk.red(`Directory already exists: ${targetDir}`));
      process.exit(1);
    }

    console.log();
    spinner.start('Creating trik...');

    // Build full config
    const config: InitConfig = {
      name,
      displayName,
      description,
      authorName,
      authorGithub,
      category,
      enableStorage,
      enableConfig,
      agentMode,
      handoffDescription,
      domainTags,
      toolNames,
    };

    // Only TypeScript is supported for now
    if (language === 'py') {
      spinner.stop();
      console.log(chalk.yellow('\n  Python trik init is not yet supported. Use TypeScript for now.\n'));
      return;
    }

    // Generate project files
    const files = generateTypescriptProject(config);

    // Create target directory and write all files
    await mkdir(targetDir, { recursive: true });

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = join(targetDir, relativePath);
      const fileDir = join(filePath, '..');
      await mkdir(fileDir, { recursive: true });
      await writeFile(filePath, content, 'utf-8');
    }

    spinner.succeed('Trik created');

    // Install dependencies
    const { execSync } = await import('node:child_process');
    let packageManager = 'npm';
    try {
      execSync('pnpm --version', { stdio: 'ignore' });
      packageManager = 'pnpm';
    } catch {
      // pnpm not available, use npm
    }

    spinner.start(`Installing dependencies with ${packageManager}...`);
    try {
      execSync(`${packageManager} install`, { cwd: targetDir, stdio: 'ignore' });
      spinner.succeed('Dependencies installed');
    } catch {
      spinner.warn(`Failed to install dependencies. Run \`${packageManager} install\` manually.`);
    }

    // Save author defaults for reuse
    saveDefaults({ authorName, authorGithub });

    // Show success message
    console.log();
    console.log(chalk.green.bold('  Your trik is ready!'));
    console.log();
    console.log(chalk.dim('  Next steps:'));
    console.log(`    cd ${name}`);
    if (agentMode === 'tool') {
      console.log('    Edit src/agent.ts to implement your tool handlers');
    } else {
      console.log('    Edit src/agent.ts to implement your agent logic');
      console.log('    Add tools in src/tools/');
      console.log('    Customize src/prompts/system.md');
    }
    console.log(`    ${packageManager === 'pnpm' ? 'pnpm' : 'npm run'} build`);
    console.log('    trik lint .');
    console.log('    trik publish');
    console.log();
  } catch (error) {
    spinner.fail('Failed to create trik');
    if (error instanceof Error) {
      // Handle user cancellation gracefully
      if (error.message.includes('User force closed')) {
        process.exit(0);
      }
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}
