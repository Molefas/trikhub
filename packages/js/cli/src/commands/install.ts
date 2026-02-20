/**
 * trik install command
 *
 * Installs a trik and registers it in .trikhub/config.json.
 *
 * Workflow:
 * 1. Check TrikHub registry first (primary source)
 * 2. If found on TrikHub:
 *    - Same runtime: add git URL to package.json + npm install (stays in node_modules)
 *    - Cross-language: download to .trikhub/triks/
 * 3. If not on TrikHub: try npm as fallback for third-party packages
 * 4. Update .trikhub/config.json with the trik
 */

import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import * as semver from 'semver';
import { validateManifest } from '@trikhub/manifest';
import { registry } from '../lib/registry.js';
import { TrikVersion, TrikRuntime } from '../types.js';

type ProjectType = 'node' | 'python';

/**
 * Detect whether this is a Node.js or Python project
 */
function detectProjectType(baseDir: string): ProjectType {
  // Check for Python project indicators first (more specific)
  if (existsSync(join(baseDir, 'pyproject.toml'))) {
    return 'python';
  }
  if (existsSync(join(baseDir, 'setup.py'))) {
    return 'python';
  }
  if (existsSync(join(baseDir, 'requirements.txt')) && !existsSync(join(baseDir, 'package.json'))) {
    return 'python';
  }
  // Default to node (package.json is checked later)
  return 'node';
}

interface InstallOptions {
  version?: string;
}

interface NpmTriksConfig {
  triks: string[];
  /** Packages installed from TrikHub registry (not npm) - need reinstall on sync */
  trikhub?: Record<string, string>; // packageName -> version
  /** Runtime for each trik (node or python) - used for cross-language uninstall */
  runtimes?: Record<string, TrikRuntime>;
}

type PackageManager = 'npm' | 'pnpm' | 'yarn';

const NPM_CONFIG_DIR = '.trikhub';
const NPM_CONFIG_FILE = 'config.json';

/**
 * Detect which package manager is being used in the project
 */
function detectPackageManager(baseDir: string): PackageManager {
  if (existsSync(join(baseDir, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(join(baseDir, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

/**
 * Run a command and capture output
 */
function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options: { silent?: boolean } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      shell: true,
      stdio: options.silent ? 'pipe' : 'inherit',
    });

    let stdout = '';
    let stderr = '';

    if (options.silent) {
      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });
    }

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    proc.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

/**
 * Get the path to the npm-based config file
 */
function getNpmConfigPath(baseDir: string): string {
  return join(baseDir, NPM_CONFIG_DIR, NPM_CONFIG_FILE);
}

/**
 * Read the npm-based trik config
 */
async function readNpmConfig(baseDir: string): Promise<NpmTriksConfig> {
  const configPath = getNpmConfigPath(baseDir);

  if (!existsSync(configPath)) {
    return { triks: [] };
  }

  try {
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as NpmTriksConfig;
    return {
      triks: Array.isArray(config.triks) ? config.triks : [],
      trikhub: config.trikhub ?? {},
      runtimes: config.runtimes ?? {},
    };
  } catch {
    return { triks: [] };
  }
}

/**
 * Write the npm-based trik config
 */
async function writeNpmConfig(config: NpmTriksConfig, baseDir: string): Promise<void> {
  const configPath = getNpmConfigPath(baseDir);
  const configDir = dirname(configPath);

  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Check if a package in node_modules is a valid trik
 */
async function isTrikPackage(packagePath: string): Promise<boolean> {
  const manifestPath = join(packagePath, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return false;
  }

  try {
    const content = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);
    const validation = validateManifest(manifest);
    return validation.valid;
  } catch {
    return false;
  }
}

/**
 * Add a trik to the config
 * @param trikhubVersion - If provided, marks this as a TrikHub-only package (not on npm)
 * @param runtime - The trik runtime (node or python) - used for cross-language uninstall
 */
async function addTrikToConfig(
  packageName: string,
  baseDir: string,
  trikhubVersion?: string,
  runtime?: TrikRuntime
): Promise<void> {
  const config = await readNpmConfig(baseDir);

  if (!config.triks.includes(packageName)) {
    config.triks = [...config.triks, packageName].sort();
  }

  // Track TrikHub source for reinstallation
  if (trikhubVersion) {
    if (!config.trikhub) {
      config.trikhub = {};
    }
    config.trikhub[packageName] = trikhubVersion;
  }

  // Track runtime for cross-language uninstall
  if (runtime) {
    if (!config.runtimes) {
      config.runtimes = {};
    }
    config.runtimes[packageName] = runtime;
  }

  await writeNpmConfig(config, baseDir);
}

/**
 * Verify that a GitHub tag points to the expected commit SHA
 */
async function verifyGitHubTagSha(
  githubRepo: string,
  gitTag: string,
  expectedSha: string
): Promise<{ valid: boolean; currentSha?: string }> {
  try {
    // Use GitHub API to get the tag reference
    const response = await fetch(
      `https://api.github.com/repos/${githubRepo}/git/refs/tags/${gitTag}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { valid: false };
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json() as { object: { sha: string; type: string } };
    let currentSha = data.object.sha;

    // If it's an annotated tag, we need to dereference it
    if (data.object.type === 'tag') {
      const tagResponse = await fetch(
        `https://api.github.com/repos/${githubRepo}/git/tags/${currentSha}`
      );
      if (tagResponse.ok) {
        const tagData = await tagResponse.json() as { object: { sha: string } };
        currentSha = tagData.object.sha;
      }
    }

    return {
      valid: currentSha === expectedSha,
      currentSha,
    };
  } catch {
    // If we can't verify, proceed with caution
    return { valid: true };
  }
}

/**
 * Add a dependency to package.json using git URL format
 */
async function addToPackageJson(
  packageName: string,
  githubRepo: string,
  gitTag: string,
  baseDir: string
): Promise<void> {
  const packageJsonPath = join(baseDir, 'package.json');
  const content = await readFile(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(content) as { dependencies?: Record<string, string> };

  if (!pkg.dependencies) {
    pkg.dependencies = {};
  }

  // Use GitHub shorthand format - clean and npm/pnpm compatible
  pkg.dependencies[packageName] = `github:${githubRepo}#${gitTag}`;

  await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

/**
 * Remove a package from node_modules to force fresh install
 */
async function removeFromNodeModules(packageName: string, baseDir: string): Promise<void> {
  const packagePath = join(baseDir, 'node_modules', ...packageName.split('/'));
  if (existsSync(packagePath)) {
    const { rm } = await import('node:fs/promises');
    await rm(packagePath, { recursive: true, force: true });
  }
}

/**
 * Try to install from npm registry
 */
async function tryNpmInstall(
  pm: PackageManager,
  packageSpec: string,
  baseDir: string
): Promise<{ success: boolean; notFound: boolean }> {
  // Use --prefix to explicitly set install directory (npm can ignore cwd in some contexts)
  const args = pm === 'npm' ? ['install', '--prefix', baseDir, packageSpec] : ['add', packageSpec];

  // Run silently to capture output
  const result = await runCommand(pm, args, baseDir, { silent: true });

  if (result.code === 0) {
    return { success: true, notFound: false };
  }

  // Check if it's a 404 (not found) error
  const isNotFound = result.stderr.includes('404') ||
    result.stderr.includes('Not found') ||
    result.stderr.includes('is not in this registry');

  return { success: false, notFound: isNotFound };
}

/**
 * Download a trik to .trikhub/triks/ for cross-language installation
 * This is used when the trik runtime doesn't match the project type.
 */
async function downloadToTriksDirectory(
  packageName: string,
  githubRepo: string,
  gitTag: string,
  baseDir: string,
  spinner: ReturnType<typeof ora>
): Promise<{ success: boolean; trikPath: string }> {
  const triksDir = join(baseDir, '.trikhub', 'triks');

  // Handle scoped packages: @scope/name -> .trikhub/triks/@scope/name
  const trikDir = join(triksDir, ...packageName.split('/'));

  // Create parent directories
  await mkdir(dirname(trikDir), { recursive: true });

  // Remove existing directory if it exists
  if (existsSync(trikDir)) {
    spinner.text = `Removing existing ${chalk.cyan(packageName)}...`;
    await runCommand('rm', ['-rf', trikDir], baseDir, { silent: true });
  }

  // Clone the repository at the specific tag
  spinner.text = `Downloading ${chalk.cyan(packageName)}...`;
  const cloneResult = await runCommand(
    'git',
    ['clone', '--depth', '1', '--branch', gitTag, `https://github.com/${githubRepo}.git`, trikDir],
    baseDir,
    { silent: true }
  );

  if (cloneResult.code !== 0) {
    return { success: false, trikPath: trikDir };
  }

  // Remove .git directory to save space
  await runCommand('rm', ['-rf', join(trikDir, '.git')], baseDir, { silent: true });

  return { success: true, trikPath: trikDir };
}

/**
 * Install a JS trik from TrikHub registry using git URLs in package.json.
 * This keeps JS triks in node_modules where they belong.
 */
async function installFromTrikhub(
  packageName: string,
  requestedVersion: string | undefined,
  baseDir: string,
  pm: PackageManager,
  spinner: ReturnType<typeof ora>
): Promise<{ success: boolean; version?: string }> {
  // Fetch trik info from TrikHub registry
  spinner.text = `Fetching ${chalk.cyan(packageName)} from TrikHub registry...`;
  const trikInfo = await registry.getTrik(packageName);

  if (!trikInfo) {
    return { success: false };
  }

  // Determine version to install
  let versionToInstall: string;
  let versionInfo: TrikVersion | undefined;

  if (!requestedVersion) {
    versionToInstall = trikInfo.latestVersion;
    versionInfo = trikInfo.versions.find((v) => v.version === versionToInstall);
  } else if (semver.valid(requestedVersion)) {
    versionToInstall = requestedVersion;
    versionInfo = trikInfo.versions.find((v) => v.version === versionToInstall);
  } else if (semver.validRange(requestedVersion)) {
    const availableVersions = trikInfo.versions.map((v) => v.version);
    const resolvedVersion = semver.maxSatisfying(availableVersions, requestedVersion);

    if (!resolvedVersion) {
      spinner.fail(`No version matching ${chalk.red(requestedVersion)} found for ${packageName}`);
      console.log(chalk.dim(`Available versions: ${availableVersions.join(', ')}`));
      return { success: false };
    }

    versionToInstall = resolvedVersion;
    versionInfo = trikInfo.versions.find((v) => v.version === resolvedVersion);
  } else {
    spinner.fail(`Invalid version: ${chalk.red(requestedVersion)}`);
    return { success: false };
  }

  if (!versionInfo) {
    spinner.fail(`Version ${chalk.red(versionToInstall)} not found for ${packageName}`);
    return { success: false };
  }

  // Verify the commit SHA hasn't changed (security check)
  spinner.text = `Verifying ${chalk.cyan(packageName)}@${versionToInstall}...`;
  const verification = await verifyGitHubTagSha(
    trikInfo.githubRepo,
    versionInfo.gitTag,
    versionInfo.commitSha
  );

  if (!verification.valid) {
    spinner.fail(`Security warning: Tag ${versionInfo.gitTag} has been modified!`);
    console.log(chalk.red('\nThe git tag no longer points to the same commit as when it was published.'));
    console.log(chalk.dim(`  Expected SHA: ${versionInfo.commitSha}`));
    if (verification.currentSha) {
      console.log(chalk.dim(`  Current SHA:  ${verification.currentSha}`));
    }
    console.log(chalk.red('\nThis could indicate tampering. Aborting installation.'));
    return { success: false };
  }

  // IMPORTANT: Remove existing package from node_modules to force fresh install
  // This fixes the issue where npm caches git dependencies
  spinner.text = `Removing existing ${chalk.cyan(packageName)} from node_modules...`;
  await removeFromNodeModules(packageName, baseDir);

  // Install directly using the git URL to bypass npm cache
  // This is more reliable than updating package.json + npm install
  const gitUrl = `github:${trikInfo.githubRepo}#${versionInfo.gitTag}`;
  spinner.text = `Installing ${chalk.cyan(packageName)}@${versionToInstall}...`;

  let installArgs: string[];
  if (pm === 'npm') {
    // npm install <package-name>@<git-url> --prefix <dir>
    installArgs = ['install', '--prefix', baseDir, `${packageName}@${gitUrl}`];
  } else if (pm === 'pnpm') {
    // pnpm add <package-name>@<git-url>
    installArgs = ['add', `${packageName}@${gitUrl}`];
  } else {
    // yarn add <package-name>@<git-url>
    installArgs = ['add', `${packageName}@${gitUrl}`];
  }

  const installResult = await runCommand(pm, installArgs, baseDir, { silent: true });

  if (installResult.code !== 0) {
    spinner.fail(`Failed to install ${packageName}`);
    console.log(chalk.dim(installResult.stderr));
    return { success: false };
  }

  // Report download for analytics
  registry.reportDownload(packageName, versionToInstall);

  return { success: true, version: versionToInstall };
}

/**
 * Install a cross-language trik from TrikHub registry.
 * Downloads to .trikhub/triks/ directory for non-JS triks in JS projects.
 */
async function installFromTrikhubRegistry(
  packageName: string,
  requestedVersion: string | undefined,
  baseDir: string,
  spinner: ReturnType<typeof ora>
): Promise<{ success: boolean; version?: string; runtime?: TrikRuntime }> {
  // Fetch trik info from TrikHub registry
  spinner.text = `Fetching ${chalk.cyan(packageName)} from TrikHub registry...`;
  const trikInfo = await registry.getTrik(packageName);

  if (!trikInfo) {
    return { success: false };
  }

  // Determine version to install
  let versionToInstall: string;
  let versionInfo: TrikVersion | undefined;

  if (!requestedVersion) {
    versionToInstall = trikInfo.latestVersion;
    versionInfo = trikInfo.versions.find((v) => v.version === versionToInstall);
  } else if (semver.valid(requestedVersion)) {
    versionToInstall = requestedVersion;
    versionInfo = trikInfo.versions.find((v) => v.version === versionToInstall);
  } else if (semver.validRange(requestedVersion)) {
    const availableVersions = trikInfo.versions.map((v) => v.version);
    const resolvedVersion = semver.maxSatisfying(availableVersions, requestedVersion);

    if (!resolvedVersion) {
      spinner.fail(`No version matching ${chalk.red(requestedVersion)} found for ${packageName}`);
      console.log(chalk.dim(`Available versions: ${availableVersions.join(', ')}`));
      return { success: false };
    }

    versionToInstall = resolvedVersion;
    versionInfo = trikInfo.versions.find((v) => v.version === resolvedVersion);
  } else {
    spinner.fail(`Invalid version: ${chalk.red(requestedVersion)}`);
    return { success: false };
  }

  if (!versionInfo) {
    spinner.fail(`Version ${chalk.red(versionToInstall)} not found for ${packageName}`);
    return { success: false };
  }

  // Verify the commit SHA hasn't changed (security check)
  spinner.text = `Verifying ${chalk.cyan(packageName)}@${versionToInstall}...`;
  const verification = await verifyGitHubTagSha(
    trikInfo.githubRepo,
    versionInfo.gitTag,
    versionInfo.commitSha
  );

  if (!verification.valid) {
    spinner.fail(`Security warning: Tag ${versionInfo.gitTag} has been modified!`);
    console.log(chalk.red('\nThe git tag no longer points to the same commit as when it was published.'));
    console.log(chalk.dim(`  Expected SHA: ${versionInfo.commitSha}`));
    if (verification.currentSha) {
      console.log(chalk.dim(`  Current SHA:  ${verification.currentSha}`));
    }
    console.log(chalk.red('\nThis could indicate tampering. Aborting installation.'));
    return { success: false };
  }

  // Download to .trikhub/triks/
  const downloadResult = await downloadToTriksDirectory(
    packageName,
    trikInfo.githubRepo,
    versionInfo.gitTag,
    baseDir,
    spinner
  );

  if (!downloadResult.success) {
    spinner.fail(`Failed to download ${packageName}`);
    return { success: false };
  }

  // Report download for analytics
  registry.reportDownload(packageName, versionToInstall);

  return { success: true, version: versionToInstall, runtime: versionInfo.runtime };
}

/**
 * Check if a trik in .trikhub/triks/ is valid
 */
async function isTrikInTriksDir(trikPath: string): Promise<boolean> {
  const manifestPath = join(trikPath, 'manifest.json');
  if (!existsSync(manifestPath)) {
    // Check for Python trik structure: package_name/manifest.json
    const entries = existsSync(trikPath) ? await readFile(trikPath, 'utf-8').catch(() => null) : null;
    if (!entries) {
      // Try to find manifest in subdirectory (Python package structure)
      try {
        const dirEntries = await import('node:fs/promises').then(fs => fs.readdir(trikPath, { withFileTypes: true }));
        for (const entry of dirEntries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const subManifest = join(trikPath, entry.name, 'manifest.json');
            if (existsSync(subManifest)) {
              return true;
            }
          }
        }
      } catch {
        return false;
      }
    }
    return false;
  }

  try {
    const content = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);
    const validation = validateManifest(manifest);
    return validation.valid;
  } catch {
    return false;
  }
}

export async function installCommand(
  trikInput: string,
  options: InstallOptions
): Promise<void> {
  const spinner = ora();
  const baseDir = process.cwd();

  try {
    // Detect project type
    const projectType = detectProjectType(baseDir);

    // Check for package.json (required for Node projects)
    const packageJsonPath = join(baseDir, 'package.json');
    if (projectType === 'node' && !existsSync(packageJsonPath)) {
      console.log(chalk.red('No package.json found in current directory.'));
      console.log(chalk.dim('Run `npm init` or `pnpm init` first.'));
      process.exit(1);
    }

    // Parse package name and version
    let packageName = trikInput;
    let versionSpec = options.version;

    // Handle @scope/name@version format
    const atIndex = trikInput.lastIndexOf('@');
    if (atIndex > 0 && !trikInput.startsWith('@', atIndex)) {
      packageName = trikInput.substring(0, atIndex);
      versionSpec = versionSpec ?? trikInput.substring(atIndex + 1);
    }

    // First, check TrikHub registry - this is the primary source for triks
    spinner.start(`Checking ${chalk.cyan(packageName)} on TrikHub registry...`);
    const trikInfo = await registry.getTrik(packageName);

    if (trikInfo) {
      // Found on TrikHub registry
      let trikRuntime: TrikRuntime = 'node';
      const latestVersion = trikInfo.versions.find(v => v.version === trikInfo.latestVersion);
      if (latestVersion?.runtime) {
        trikRuntime = latestVersion.runtime;
      }

      const isCrossLanguage = projectType !== trikRuntime;

      if (isCrossLanguage) {
        // Cross-language: download to .trikhub/triks/
        spinner.info(`Cross-language trik: ${chalk.cyan(trikRuntime)} trik in ${chalk.cyan(projectType)} project`);
        spinner.start(`Installing ${chalk.cyan(packageName)} to .trikhub/triks/...`);

        const trikhubResult = await installFromTrikhubRegistry(packageName, versionSpec, baseDir, spinner);

        if (trikhubResult.success) {
          await addTrikToConfig(packageName, baseDir, trikhubResult.version, trikRuntime);
          spinner.succeed(`Installed ${chalk.green(packageName)}@${trikhubResult.version} from TrikHub`);

          console.log();
          console.log(chalk.dim(`  Downloaded to: .trikhub/triks/${packageName}`));
          console.log(chalk.dim(`  Registered in: .trikhub/config.json`));
          console.log();
          console.log(chalk.dim('The trik will run via the cross-language worker.'));
        } else {
          spinner.fail(`Failed to install ${chalk.red(packageName)}`);
          process.exit(1);
        }
      } else {
        // Same language (JS trik in JS project): use git URL in package.json
        spinner.info(`Found ${chalk.cyan(packageName)} on TrikHub registry`);

        const pm = detectPackageManager(baseDir);
        const trikhubResult = await installFromTrikhub(packageName, versionSpec, baseDir, pm, spinner);

        if (trikhubResult.success) {
          await addTrikToConfig(packageName, baseDir, trikhubResult.version);
          spinner.succeed(`Installed ${chalk.green(packageName)}@${trikhubResult.version} from TrikHub`);

          console.log();
          console.log(chalk.dim(`  Added to: package.json`));
          console.log(chalk.dim(`  Registered in: .trikhub/config.json`));
          console.log();
          console.log(chalk.dim('The trik will be available to your AI agent.'));
        } else {
          spinner.fail(`Failed to install ${chalk.red(packageName)}`);
          process.exit(1);
        }
      }
    } else {
      // Not on TrikHub registry - try npm as fallback for third-party packages
      if (projectType === 'node') {
        // Ensure node_modules exists
        const nodeModulesPath = join(baseDir, 'node_modules');
        if (!existsSync(nodeModulesPath)) {
          mkdirSync(nodeModulesPath, { recursive: true });
        }

        // Detect package manager
        const pm = detectPackageManager(baseDir);
        spinner.info(`Not found on TrikHub, trying npm...`);
        spinner.info(`Using ${chalk.cyan(pm)} as package manager`);

        const packageSpec = versionSpec ? `${packageName}@${versionSpec}` : packageName;

        // Try npm registry
        spinner.start(`Looking for ${chalk.cyan(packageSpec)} on npm...`);
        const npmResult = await tryNpmInstall(pm, packageSpec, baseDir);

        if (npmResult.success) {
          spinner.succeed(`Installed ${chalk.green(packageName)} from npm`);

          // Check if the installed package is a trik and register it
          spinner.start('Checking if package is a trik...');
          const packagePath = join(baseDir, 'node_modules', ...packageName.split('/'));

          if (await isTrikPackage(packagePath)) {
            await addTrikToConfig(packageName, baseDir);
            spinner.succeed(`Registered ${chalk.green(packageName)} as a trik`);

            console.log();
            console.log(chalk.dim(`  Added to: package.json`));
            console.log(chalk.dim(`  Registered in: .trikhub/config.json`));
            console.log();
            console.log(chalk.dim('The trik will be available to your AI agent.'));
          } else {
            spinner.info(`${chalk.yellow(packageName)} installed but is not a trik (no manifest.json)`);
            console.log(chalk.dim('\nThe package was added to your dependencies.'));
          }
        } else {
          spinner.fail(`${chalk.red(packageName)} not found on TrikHub or npm`);
          process.exit(1);
        }
      } else {
        // Python project - not yet implemented
        spinner.fail('Python project installation not yet implemented in this CLI');
        console.log(chalk.dim('\nUse pip to install Python triks directly:'));
        console.log(chalk.dim(`  pip install ${packageName}`));
        process.exit(1);
      }
    }

  } catch (error) {
    spinner.fail('Installation failed');
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}
