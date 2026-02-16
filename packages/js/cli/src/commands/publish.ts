/**
 * trik publish command
 *
 * Publishes a trik to the TrikHub registry.
 *
 * New simplified flow:
 * 1. Validate trik structure
 * 2. Verify git tag exists on remote
 * 3. Get commit SHA for the tag
 * 4. Register with TrikHub registry (no tarball, no GitHub Release)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { TrikHubMetadata } from '../types.js';
import { RegistryClient } from '../lib/registry.js';
import { loadConfig } from '../lib/storage.js';
import { validateTrik, formatValidationResult } from '../lib/validator.js';

interface PublishOptions {
  directory?: string;
  tag?: string;
}

interface TrikManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  entry: {
    module: string;
    export: string;
  };
  actions: Record<string, unknown>;
  capabilities?: unknown;
  limits?: unknown;
}

/**
 * Get the commit SHA that a tag points to on the remote
 */
function getRemoteTagCommitSha(trikDir: string, tag: string): string | null {
  try {
    // First try to get the tag's commit from the remote
    const result = execSync(`git ls-remote --tags origin refs/tags/${tag}`, {
      cwd: trikDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!result) {
      return null;
    }

    // Format is: "sha\trefs/tags/tagname"
    const sha = result.split('\t')[0];

    // If it's an annotated tag, we need to dereference it to get the commit SHA
    const derefResult = execSync(`git ls-remote --tags origin refs/tags/${tag}^{}`, {
      cwd: trikDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (derefResult) {
      // Annotated tag - use dereferenced commit
      return derefResult.split('\t')[0];
    }

    // Lightweight tag - use the SHA directly
    return sha;
  } catch {
    return null;
  }
}

/**
 * Check if the dist/ directory is committed (not ignored)
 */
function isDistCommitted(trikDir: string): boolean {
  try {
    // Check if dist/ is tracked in git
    const result = execSync('git ls-files dist/', {
      cwd: trikDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    return result.length > 0;
  } catch {
    return false;
  }
}

export async function publishCommand(options: PublishOptions): Promise<void> {
  const spinner = ora();
  const config = loadConfig();

  // Check if logged in
  if (!config.authToken) {
    console.log(chalk.red('Not logged in'));
    console.log(chalk.dim('Run `trik login` to authenticate first'));
    process.exit(1);
  }

  // Check if token is expired
  if (config.authExpiresAt && new Date(config.authExpiresAt) < new Date()) {
    console.log(chalk.red('Session expired'));
    console.log(chalk.dim('Run `trik login` to re-authenticate'));
    process.exit(1);
  }

  const trikDir = resolve(options.directory || '.');

  try {
    // Step 1: Validate trik structure
    spinner.start('Validating trik structure...');

    // Check required files exist
    const manifestPath = join(trikDir, 'manifest.json');
    const trikhubPath = join(trikDir, 'trikhub.json');

    if (!existsSync(manifestPath)) {
      spinner.fail('Missing manifest.json');
      console.log(chalk.dim('Create a manifest.json file with your trik definition'));
      process.exit(1);
    }

    if (!existsSync(trikhubPath)) {
      spinner.fail('Missing trikhub.json');
      console.log(chalk.dim('Create a trikhub.json file with registry metadata'));
      process.exit(1);
    }

    // Read manifest
    let manifest: TrikManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch (error) {
      spinner.fail('Invalid manifest.json');
      console.log(chalk.red(error instanceof Error ? error.message : 'Parse error'));
      process.exit(1);
    }

    // Read trikhub.json
    let trikhubMeta: TrikHubMetadata;
    try {
      trikhubMeta = JSON.parse(readFileSync(trikhubPath, 'utf-8'));
    } catch (error) {
      spinner.fail('Invalid trikhub.json');
      console.log(chalk.red(error instanceof Error ? error.message : 'Parse error'));
      process.exit(1);
    }

    // Check entry point exists
    const entryPath = join(trikDir, manifest.entry.module);
    if (!existsSync(entryPath)) {
      spinner.fail(`Missing entry point: ${manifest.entry.module}`);
      console.log(chalk.dim('Build your trik first (e.g., npm run build)'));
      process.exit(1);
    }

    // Run validation
    const validation = validateTrik(trikDir);
    if (!validation.valid) {
      spinner.fail('Validation failed');
      console.log(formatValidationResult(validation));
      process.exit(1);
    }

    if (validation.warnings.length > 0) {
      spinner.warn('Validation passed with warnings');
      console.log(formatValidationResult(validation));
    } else {
      spinner.succeed('Validation passed');
    }

    // Step 2: Determine version and git tag
    const version = options.tag?.replace(/^v/, '') || manifest.version;
    const gitTag = `v${version}`;
    console.log(chalk.dim(`  Version: ${version}`));

    // Step 3: Get GitHub repo from trikhub.json
    const repoUrl = trikhubMeta.repository;
    const repoMatch = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (!repoMatch) {
      console.log(chalk.red('Invalid repository URL in trikhub.json'));
      console.log(chalk.dim('Expected format: https://github.com/owner/repo'));
      process.exit(1);
    }
    const githubRepo = repoMatch[1].replace(/\.git$/, '');
    const [owner] = githubRepo.split('/');
    const trikName = manifest.id || manifest.name;
    const fullName = `@${owner}/${trikName}`;

    // Step 4: Verify git remote matches trikhub.json repository
    spinner.start('Verifying git remote...');
    try {
      const gitRemote = execSync('git remote get-url origin', {
        cwd: trikDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      // Normalize URLs for comparison (handle SSH and HTTPS variants)
      const normalizeGitUrl = (url: string): string => {
        return url
          .replace(/^git@github\.com:/, 'github.com/')
          .replace(/^https?:\/\//, '')
          .replace(/\.git$/, '')
          .toLowerCase();
      };

      const normalizedRemote = normalizeGitUrl(gitRemote);

      if (!normalizedRemote.includes(githubRepo.toLowerCase())) {
        spinner.fail('Git remote does not match trikhub.json repository');
        console.log(chalk.red('\nRepository mismatch detected:'));
        console.log(chalk.dim(`  trikhub.json: ${repoUrl}`));
        console.log(chalk.dim(`  git remote:   ${gitRemote}`));
        console.log();
        console.log(chalk.dim('Update trikhub.json to match your git remote, or push to the correct repository.'));
        process.exit(1);
      }
      spinner.succeed('Git remote verified');
    } catch {
      // Not a git repo or no remote configured
      spinner.fail('Not a git repository or no remote configured');
      console.log(chalk.dim('Initialize git and add a remote that matches trikhub.json:'));
      console.log(chalk.dim(`  git init`));
      console.log(chalk.dim(`  git remote add origin ${repoUrl}`));
      process.exit(1);
    }

    console.log(chalk.dim(`  Trik: ${fullName}`));
    console.log(chalk.dim(`  Repo: ${githubRepo}`));

    // Step 5: Check that dist/ is committed
    spinner.start('Checking dist/ is committed...');
    if (!isDistCommitted(trikDir)) {
      spinner.fail('dist/ directory is not committed to git');
      console.log(chalk.red('\nTriks require dist/ to be committed for direct GitHub installation.'));
      console.log(chalk.dim('Add dist/ to your repository:'));
      console.log(chalk.dim(`  git add dist/ -f`));
      console.log(chalk.dim(`  git commit -m "Add dist for publishing"`));
      console.log(chalk.dim(`  git push`));
      process.exit(1);
    }
    spinner.succeed('dist/ is committed');

    // Step 6: Verify git tag exists on remote
    spinner.start(`Verifying tag ${gitTag} exists on remote...`);
    const commitSha = getRemoteTagCommitSha(trikDir, gitTag);

    if (!commitSha) {
      spinner.fail(`Tag ${gitTag} not found on remote`);
      console.log(chalk.red('\nThe git tag must exist on the remote before publishing.'));
      console.log(chalk.dim('Create and push the tag:'));
      console.log(chalk.dim(`  git tag ${gitTag}`));
      console.log(chalk.dim(`  git push origin ${gitTag}`));
      process.exit(1);
    }
    spinner.succeed(`Tag ${gitTag} verified (${commitSha.slice(0, 8)}...)`);

    // Step 7: Register with registry
    spinner.start('Publishing to TrikHub registry...');

    const registry = new RegistryClient();

    try {
      // Check if trik exists, if not register it
      const existingTrik = await registry.getTrik(fullName);

      if (!existingTrik) {
        // Register new trik
        try {
          await registry.registerTrik({
            githubRepo,
            name: trikName, // Explicit name from manifest.id
            description: trikhubMeta.shortDescription || manifest.description,
            categories: trikhubMeta.categories,
            keywords: trikhubMeta.keywords,
          });
          console.log(chalk.dim(`  Registered new trik: ${fullName}`));
        } catch (regError) {
          // If trik already exists (409), that's fine - continue to publish version
          // This can happen if the trik was registered but GET didn't find it
          if (regError instanceof Error && !regError.message.includes('already exists')) {
            throw regError;
          }
          console.log(chalk.dim(`  Trik already registered: ${fullName}`));
        }
      }

      // Publish version
      await registry.publishVersion(fullName, {
        version,
        gitTag,
        commitSha,
        manifest: manifest as unknown as Record<string, unknown>,
      });

      spinner.succeed('Published to TrikHub registry');
    } catch (error) {
      spinner.fail('Failed to publish to registry');
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }

    // Success message
    console.log();
    console.log(chalk.green.bold('  Published successfully!'));
    console.log();
    console.log(`  ${chalk.dim('Install with:')} trik install ${fullName}@${version}`);
    console.log(`  ${chalk.dim('View at:')} https://trikhub.com/triks/${encodeURIComponent(fullName)}`);
    console.log();
  } catch (error) {
    spinner.fail('Publish failed');
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}
