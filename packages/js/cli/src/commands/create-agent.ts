/**
 * trik create-agent command
 *
 * Scaffolds a minimal agent project ready to consume triks.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { input, select } from '@inquirer/prompts';
import { generateAgentTypescriptProject } from '../templates/agent-typescript.js';
import { generateAgentPythonProject } from '../templates/agent-python.js';
import type { CreateAgentConfig } from '../templates/agent-typescript.js';

type Language = 'ts' | 'py';

/**
 * Validate project name — same rules as trik init.
 */
function validateProjectName(name: string): string | true {
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
 * Parse and normalize language argument.
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

export async function createAgentCommand(languageArg: string): Promise<void> {
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
    console.log(chalk.bold('  Create a new Agent'));
    console.log();

    // Interactive prompts
    const name = await input({
      message: 'Project name:',
      default: 'my-agent',
      validate: validateProjectName,
      transformer: (value) => value.toLowerCase(),
    });

    const provider = await select<'openai' | 'anthropic' | 'google'>({
      message: 'LLM Provider:',
      choices: [
        { value: 'openai', name: 'OpenAI (gpt-4o-mini)' },
        { value: 'anthropic', name: 'Anthropic (claude-sonnet)' },
        { value: 'google', name: 'Google (gemini-2.0-flash)' },
      ],
      default: 'openai',
    });

    // Path selection
    const pathChoice = await select<'current' | 'other'>({
      message: 'Where to create the project?',
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
    spinner.start('Creating agent project...');

    // Build config
    const config: CreateAgentConfig = { name, provider };

    // Generate project files
    const files = language === 'ts'
      ? generateAgentTypescriptProject(config)
      : generateAgentPythonProject(config);

    // Create target directory and write all files
    await mkdir(targetDir, { recursive: true });

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = join(targetDir, relativePath);
      const fileDir = join(filePath, '..');
      await mkdir(fileDir, { recursive: true });
      await writeFile(filePath, content, 'utf-8');
    }

    spinner.succeed('Agent project created');

    // Install dependencies (TypeScript only)
    let packageManager = 'npm';
    if (language === 'ts') {
      const { execSync } = await import('node:child_process');
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
    }

    // Show success message
    console.log();
    console.log(chalk.green.bold('  Your agent is ready!'));
    console.log();
    console.log(chalk.dim('  Next steps:'));
    console.log(`    cd ${name}`);
    console.log('    cp .env.example .env');
    console.log('    # Add your API key to .env');

    if (language === 'py') {
      console.log('    python -m venv .venv && source .venv/bin/activate');
      console.log('    pip install -e .');
      console.log('    python cli.py');
    } else {
      console.log(`    ${packageManager === 'pnpm' ? 'pnpm' : 'npm run'} dev`);
    }

    console.log();
    console.log(chalk.dim('  Install triks:'));
    console.log('    trik install @scope/trik-name');
    console.log();
  } catch (error) {
    spinner.fail('Failed to create agent project');
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
