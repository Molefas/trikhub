/**
 * trik lint command
 *
 * Validates a trik's manifest and source files for security and correctness.
 * This is a wrapper around @trikhub/linter.
 */

import { resolve } from 'node:path';
import chalk from 'chalk';
import { TrikLinter } from '@trikhub/linter';

interface LintOptions {
  warningsAsErrors?: boolean;
  skip?: string[];
}

export async function lintCommand(trikPath: string, options: LintOptions): Promise<void> {
  const resolvedPath = resolve(trikPath);

  console.log(`Linting trik at: ${resolvedPath}\n`);

  const linter = new TrikLinter({
    warningsAsErrors: options.warningsAsErrors,
    skipRules: options.skip,
  });

  try {
    const results = await linter.lint(resolvedPath);
    console.log(linter.formatResults(results));

    if (linter.hasErrors(results)) {
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
