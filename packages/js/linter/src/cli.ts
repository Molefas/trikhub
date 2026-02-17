#!/usr/bin/env node
import { resolve } from 'node:path';
import { TrikLinter } from './linter.js';

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
  valid-manifest         Manifest must be valid JSON and match schema
  manifest-completeness  Check for recommended manifest fields
  has-source-files       Trik must have TypeScript source files
  entry-point-exists     Entry point in manifest must exist
  no-forbidden-imports   Block dangerous Node.js modules
  no-dynamic-code        Block eval() and Function constructor
  undeclared-tool        Tools used must be declared in manifest
  no-process-env         Warn on process.env access
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
    const results = await linter.lint(trikPath);
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
