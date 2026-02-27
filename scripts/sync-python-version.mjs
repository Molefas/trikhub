#!/usr/bin/env node

/**
 * Syncs the Python package version to match the JS packages.
 *
 * Reads the version from @trikhub/manifest (part of the fixed group)
 * and updates:
 *   - packages/python/pyproject.toml
 *   - packages/python/trikhub/__init__.py
 *   - packages/python/trikhub/cli/main.py
 *
 * Run after `changeset version` to keep Python in lockstep.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Read version from any fixed-group JS package
const manifestPkg = JSON.parse(
  readFileSync(join(root, 'packages/js/manifest/package.json'), 'utf-8')
);
const version = manifestPkg.version;

console.log(`Syncing Python package to v${version}`);

// 1. Update pyproject.toml
const pyprojectPath = join(root, 'packages/python/pyproject.toml');
let pyproject = readFileSync(pyprojectPath, 'utf-8');
pyproject = pyproject.replace(
  /^version = ".*"$/m,
  `version = "${version}"`
);
writeFileSync(pyprojectPath, pyproject);
console.log(`  Updated pyproject.toml`);

// 2. Update trikhub/__init__.py
const initPath = join(root, 'packages/python/trikhub/__init__.py');
let init = readFileSync(initPath, 'utf-8');
init = init.replace(
  /^__version__ = ".*"$/m,
  `__version__ = "${version}"`
);
writeFileSync(initPath, init);
console.log(`  Updated trikhub/__init__.py`);

// 3. Update trikhub/cli/main.py
const cliPath = join(root, 'packages/python/trikhub/cli/main.py');
let cli = readFileSync(cliPath, 'utf-8');
cli = cli.replace(
  /version="[^"]*", prog_name="trik"/,
  `version="${version}", prog_name="trik"`
);
writeFileSync(cliPath, cli);
console.log(`  Updated trikhub/cli/main.py`);

console.log(`Python package synced to v${version}`);
