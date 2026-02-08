/**
 * trik publish command
 *
 * Publishes a trik to the TrikHub registry.
 */

import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import chalk from 'chalk';
import ora from 'ora';
import * as tar from 'tar';
import { TrikHubMetadata } from '../types.js';
import { RegistryClient } from '../lib/registry.js';
import { loadConfig } from '../lib/storage.js';
import { validateTrik, formatValidationResult } from '../lib/validator.js';

interface PublishOptions {
  directory?: string;
  tag?: string;
  skipRelease?: boolean;
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

    // Step 2: Determine version
    const version = options.tag?.replace(/^v/, '') || manifest.version;
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

    // Step 3b: Verify git remote matches trikhub.json repository
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
      const normalizedExpected = normalizeGitUrl(repoUrl);

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
    } catch (error) {
      // Not a git repo or no remote configured
      spinner.fail('Not a git repository or no remote configured');
      console.log(chalk.dim('Initialize git and add a remote that matches trikhub.json:'));
      console.log(chalk.dim(`  git init`));
      console.log(chalk.dim(`  git remote add origin ${repoUrl}`));
      process.exit(1);
    }

    console.log(chalk.dim(`  Trik: ${fullName}`));
    console.log(chalk.dim(`  Repo: ${githubRepo}`));

    // Step 4: Create tarball
    spinner.start('Creating tarball...');

    const tarballName = `${trikName}-${version}.tar.gz`;
    const tarballDir = join(tmpdir(), `trikhub-publish-${Date.now()}`);
    mkdirSync(tarballDir, { recursive: true });
    const tarballPath = join(tarballDir, tarballName);

    // Files to include in tarball
    // Must include package.json for npm compatibility
    const filesToInclude = [
      'package.json',
      'manifest.json',
      'trikhub.json',
      manifest.entry.module,
    ];

    // Add dist directory if it exists
    const distDir = join(trikDir, 'dist');
    if (existsSync(distDir)) {
      filesToInclude.push('dist');
    }

    // Add README if it exists
    for (const readme of ['README.md', 'README.txt', 'README']) {
      if (existsSync(join(trikDir, readme))) {
        filesToInclude.push(readme);
        break;
      }
    }

    // Add LICENSE if it exists
    for (const license of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
      if (existsSync(join(trikDir, license))) {
        filesToInclude.push(license);
        break;
      }
    }

    // Create npm-compatible tarball with 'package/' prefix
    // This is the same structure npm pack creates
    await tar.create(
      {
        gzip: true,
        file: tarballPath,
        cwd: trikDir,
        prefix: 'package',
      },
      filesToInclude.filter((f) => existsSync(join(trikDir, f)))
    );

    // Compute SHA-256
    const tarballBuffer = readFileSync(tarballPath);
    const sha256 = createHash('sha256').update(tarballBuffer).digest('hex');

    spinner.succeed(`Tarball created (${(tarballBuffer.length / 1024).toFixed(1)} KB)`);
    console.log(chalk.dim(`  SHA-256: ${sha256.slice(0, 16)}...`));

    // Step 5: Create GitHub Release (unless skipped)
    let tarballUrl: string;

    if (options.skipRelease) {
      // User must provide tarball URL manually
      console.log(chalk.yellow('\nSkipping GitHub release creation.'));
      console.log('Please create a release manually and provide the tarball URL.');
      console.log(chalk.dim(`Tarball saved at: ${tarballPath}`));

      // For now, construct expected URL
      tarballUrl = `https://github.com/${githubRepo}/releases/download/v${version}/${tarballName}`;
      console.log(chalk.dim(`Expected tarball URL: ${tarballUrl}`));
    } else {
      spinner.start('Creating GitHub release...');

      // Check if gh CLI is available
      const ghCheck = spawnSync('gh', ['--version'], { encoding: 'utf-8' });
      if (ghCheck.status !== 0) {
        spinner.fail('GitHub CLI (gh) not found');
        console.log(chalk.dim('Install: https://cli.github.com/'));
        console.log(chalk.dim('Or use --skip-release to create the release manually'));
        // Cleanup
        rmSync(tarballDir, { recursive: true, force: true });
        process.exit(1);
      }

      // Check gh auth status
      const authCheck = spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8' });
      if (authCheck.status !== 0) {
        spinner.fail('GitHub CLI not authenticated');
        console.log(chalk.dim('Run: gh auth login'));
        rmSync(tarballDir, { recursive: true, force: true });
        process.exit(1);
      }

      // Check if the GitHub repository exists
      const repoCheck = spawnSync('gh', ['repo', 'view', githubRepo, '--json', 'name'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (repoCheck.status !== 0) {
        spinner.fail(`GitHub repository not found: ${githubRepo}`);
        console.log(chalk.red('\nThe repository does not exist on GitHub.'));
        console.log(chalk.dim('Create the repository first:'));
        console.log(chalk.dim(`  gh repo create ${githubRepo} --public --source=. --push`));
        rmSync(tarballDir, { recursive: true, force: true });
        process.exit(1);
      }

      // Create release
      try {
        const releaseResult = spawnSync(
          'gh',
          [
            'release',
            'create',
            `v${version}`,
            tarballPath,
            '--repo',
            githubRepo,
            '--title',
            `v${version}`,
            '--notes',
            `Release v${version}\n\nPublished via TrikHub CLI`,
          ],
          { encoding: 'utf-8', cwd: trikDir }
        );

        if (releaseResult.status !== 0) {
          // Check if release already exists
          if (releaseResult.stderr?.includes('already exists')) {
            spinner.info('Release already exists, uploading asset...');

            // Upload asset to existing release
            const uploadResult = spawnSync(
              'gh',
              [
                'release',
                'upload',
                `v${version}`,
                tarballPath,
                '--repo',
                githubRepo,
                '--clobber',
              ],
              { encoding: 'utf-8', cwd: trikDir }
            );

            if (uploadResult.status !== 0) {
              throw new Error(uploadResult.stderr || 'Failed to upload asset');
            }
          } else {
            throw new Error(releaseResult.stderr || 'Failed to create release');
          }
        }

        tarballUrl = `https://github.com/${githubRepo}/releases/download/v${version}/${tarballName}`;
        spinner.succeed('GitHub release created');
      } catch (error) {
        spinner.fail('Failed to create GitHub release');
        console.log(chalk.red(error instanceof Error ? error.message : String(error)));
        rmSync(tarballDir, { recursive: true, force: true });
        process.exit(1);
      }
    }

    // Step 6: Register with registry
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
        tarballUrl,
        sha256,
        manifest: manifest as unknown as Record<string, unknown>,
      });

      spinner.succeed('Published to TrikHub registry');
    } catch (error) {
      spinner.fail('Failed to publish to registry');
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
      rmSync(tarballDir, { recursive: true, force: true });
      process.exit(1);
    }

    // Cleanup
    rmSync(tarballDir, { recursive: true, force: true });

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
