/**
 * trik lint command
 *
 * Validates a trik's manifest and source files for security and correctness.
 * This is a wrapper around @trikhub/linter.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { TrikLinter, findManifestPath } from '@trikhub/linter';
import { validateManifest } from '@trikhub/manifest';

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

    // Show quality score from manifest validation
    try {
      const manifestLocation = await findManifestPath(resolvedPath);
      if (manifestLocation) {
        const manifestContent = readFileSync(manifestLocation.manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestContent);
        const validation = validateManifest(manifest);
        if (validation.qualityScore !== undefined) {
          const score = validation.qualityScore;
          const color = score >= 80 ? chalk.green : score >= 50 ? chalk.yellow : chalk.red;
          console.log(`\n${chalk.bold('Quality Score:')} ${color(`${score}/100`)}`);
        }
      }
    } catch {
      // Skip quality score display if manifest can't be found/read
    }

    if (linter.hasErrors(results)) {
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
