/**
 * trik install command
 *
 * Installs a trik as an npm dependency and registers it in .trikhub/config.json.
 *
 * Workflow:
 * 1. Try npm registry first
 * 2. If not found, fall back to TrikHub registry (GitHub releases)
 * 3. Download and install
 * 4. Update .trikhub/config.json with the trik
 */

import { existsSync, createWriteStream, rmSync, mkdirSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import chalk from 'chalk';
import ora from 'ora';
import * as semver from 'semver';
import * as tar from 'tar';
import { validateManifest } from '@trikhub/manifest';
import { registry } from '../lib/registry.js';
import { TrikVersion } from '../types.js';

interface InstallOptions {
  version?: string;
}

interface NpmTriksConfig {
  triks: string[];
}

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
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
 */
async function addTrikToConfig(packageName: string, baseDir: string): Promise<void> {
  const config = await readNpmConfig(baseDir);

  if (!config.triks.includes(packageName)) {
    config.triks = [...config.triks, packageName].sort();
    await writeNpmConfig(config, baseDir);
  }
}

/**
 * Download a file from a URL
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  const dir = dirname(destPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const fileStream = createWriteStream(destPath);
  await pipeline(Readable.fromWeb(response.body as any), fileStream);
}

/**
 * Add a dependency to package.json
 */
async function addToPackageJson(
  packageName: string,
  version: string,
  baseDir: string
): Promise<void> {
  const packageJsonPath = join(baseDir, 'package.json');
  const content = await readFile(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(content) as PackageJson;

  if (!pkg.dependencies) {
    pkg.dependencies = {};
  }

  // Use a special prefix to indicate it's a TrikHub package
  pkg.dependencies[packageName] = `trikhub:${version}`;

  await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

/**
 * Try to install from npm registry
 */
async function tryNpmInstall(
  pm: PackageManager,
  packageSpec: string,
  baseDir: string
): Promise<{ success: boolean; notFound: boolean }> {
  const args = pm === 'npm' ? ['install', packageSpec] : ['add', packageSpec];

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
 * Install from TrikHub registry (GitHub releases)
 * Extracts directly to node_modules since TrikHub tarballs may not be npm-compatible
 */
async function installFromTrikhub(
  packageName: string,
  requestedVersion: string | undefined,
  baseDir: string,
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

  // Download the tarball
  spinner.text = `Downloading ${chalk.cyan(packageName)}@${versionToInstall}...`;
  const tempDir = join(baseDir, '.trikhub', '.tmp');
  const tarballPath = join(tempDir, `${packageName.replace('/', '-')}-${versionToInstall}.tgz`);

  try {
    await downloadFile(versionInfo.tarballUrl, tarballPath);

    // Extract directly to node_modules
    spinner.text = `Installing ${chalk.cyan(packageName)}@${versionToInstall}...`;

    // Create the target directory in node_modules
    const nodeModulesPath = join(baseDir, 'node_modules');
    const packagePath = join(nodeModulesPath, ...packageName.split('/'));

    // Ensure parent directories exist (for scoped packages)
    if (packageName.startsWith('@')) {
      const scopeDir = join(nodeModulesPath, packageName.split('/')[0]);
      if (!existsSync(scopeDir)) {
        mkdirSync(scopeDir, { recursive: true });
      }
    }

    // Remove existing installation if present
    if (existsSync(packagePath)) {
      rmSync(packagePath, { recursive: true, force: true });
    }

    // Create target directory
    mkdirSync(packagePath, { recursive: true });

    // Extract tarball to the package directory
    await tar.extract({
      file: tarballPath,
      cwd: packagePath,
    });

    // Create a minimal package.json if one doesn't exist
    const pkgJsonPath = join(packagePath, 'package.json');
    if (!existsSync(pkgJsonPath)) {
      const minimalPkg = {
        name: packageName,
        version: versionToInstall,
        description: trikInfo.description || `TrikHub package: ${packageName}`,
      };
      await writeFile(pkgJsonPath, JSON.stringify(minimalPkg, null, 2) + '\n', 'utf-8');
    }

    // Add to package.json dependencies
    await addToPackageJson(packageName, versionToInstall, baseDir);

    // Report download for analytics
    registry.reportDownload(packageName, versionToInstall);

    return { success: true, version: versionToInstall };
  } finally {
    // Clean up tarball
    if (existsSync(tarballPath)) {
      rmSync(tarballPath, { force: true });
    }
    // Clean up temp dir if empty
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export async function installCommand(
  trikInput: string,
  options: InstallOptions
): Promise<void> {
  const spinner = ora();
  const baseDir = process.cwd();

  try {
    // Check for package.json
    const packageJsonPath = join(baseDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      console.log(chalk.red('No package.json found in current directory.'));
      console.log(chalk.dim('Run `npm init` or `pnpm init` first.'));
      process.exit(1);
    }

    // Ensure node_modules exists
    const nodeModulesPath = join(baseDir, 'node_modules');
    if (!existsSync(nodeModulesPath)) {
      mkdirSync(nodeModulesPath, { recursive: true });
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

    // Detect package manager
    const pm = detectPackageManager(baseDir);
    spinner.info(`Using ${chalk.cyan(pm)} as package manager`);

    const packageSpec = versionSpec ? `${packageName}@${versionSpec}` : packageName;

    // First, try npm registry
    spinner.start(`Looking for ${chalk.cyan(packageSpec)} on npm...`);
    const npmResult = await tryNpmInstall(pm, packageSpec, baseDir);

    let installed = false;
    let installedVersion: string | undefined;

    if (npmResult.success) {
      spinner.succeed(`Installed ${chalk.green(packageName)} from npm`);
      installed = true;
    } else if (npmResult.notFound) {
      // Not on npm, try TrikHub registry
      spinner.text = `Not found on npm, checking TrikHub registry...`;
      const trikhubResult = await installFromTrikhub(packageName, versionSpec, baseDir, spinner);

      if (trikhubResult.success) {
        spinner.succeed(`Installed ${chalk.green(packageName)}@${trikhubResult.version} from TrikHub`);
        installed = true;
        installedVersion = trikhubResult.version;
      } else {
        spinner.fail(`${chalk.red(packageName)} not found on npm or TrikHub registry`);
        process.exit(1);
      }
    } else {
      // npm failed for other reasons
      spinner.fail(`Failed to install ${chalk.red(packageName)}`);
      process.exit(1);
    }

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

  } catch (error) {
    spinner.fail('Installation failed');
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}
