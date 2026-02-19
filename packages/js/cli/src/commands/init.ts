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
import { generatePythonProject } from '../templates/python.js';

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

    // Generate files
    const config = {
      name,
      displayName,
      description,
      authorName,
      authorGithub,
      category,
      enableStorage,
      enableConfig,
    };

    const files =
      language === 'ts'
        ? generateTypescriptProject(config)
        : generatePythonProject(config);

    // Write files
    for (const file of files) {
      const filePath = join(targetDir, file.path);
      const dir = join(filePath, '..');
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, file.content, 'utf-8');
    }

    // Save author defaults for next time
    if (authorName || authorGithub) {
      saveDefaults({
        authorName: authorName || defaults.authorName,
        authorGithub: authorGithub || defaults.authorGithub,
      });
    }

    spinner.succeed(`Created trik: ${chalk.green(name)}`);

    // Print next steps
    console.log();
    console.log(chalk.bold('  Next steps:'));
    console.log();
    console.log(chalk.dim(`  cd ${name}`));
    if (language === 'ts') {
      console.log(chalk.dim('  npm install'));
      console.log(chalk.dim('  npm run build'));
      console.log(chalk.dim('  npm test              # Test your trik locally'));
    } else {
      console.log(chalk.dim('  python test.py        # Test your trik locally'));
    }
    console.log(chalk.dim('  trik publish          # When ready to publish'));
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
