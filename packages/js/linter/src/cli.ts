#!/usr/bin/env node
import { resolve } from 'node:path';
import { TrikLinter } from './linter.js';
import { formatScanResult } from './scanner.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: trik-lint <trik-path> [options]

Arguments:
  trik-path    Path to the trik directory containing manifest.json

Options:
  --warnings-as-errors    Treat warnings as errors
  --skip <rule>          Skip a specific rule (can be used multiple times)
  --help, -h             Show this help message

Rules:
  valid-manifest            Manifest must be valid JSON and match schema
  manifest-completeness     Check for recommended manifest fields
  entry-point-exists        Entry point in manifest must exist
  tdps-agent-safe-output    outputSchema must use agent-safe types only
  tdps-constrained-log      logSchema must use constrained types
  tdps-log-template         logTemplate placeholders must match logSchema
  tdps-output-template      outputTemplate placeholders must match outputSchema
`);
    process.exit(0);
  }

  const trikPath = resolve(args[0]);
  const warningsAsErrors = args.includes('--warnings-as-errors');
  const skipRules: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip' && args[i + 1]) {
      skipRules.push(args[i + 1]);
      i++;
    }
  }

  const linter = new TrikLinter({
    warningsAsErrors,
    skipRules,
  });

  console.log(`Linting trik at: ${trikPath}\n`);

  try {
    const { results, scan } = await linter.lint(trikPath);

    // Show security tier first
    console.log(formatScanResult(scan));
    console.log('');

    // Then manifest validation
    console.log('Manifest validation:');
    console.log(linter.formatResults(results));

    if (linter.hasErrors(results)) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
