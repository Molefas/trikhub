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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';
import * as semver from 'semver';
import { validateManifest, type TrikManifest } from '@trikhub/manifest';
import { scanCapabilities, crossCheckManifest } from '@trikhub/linter';
import { registry } from '../lib/registry.js';
import { TrikVersion, TrikRuntime } from '../types.js';

type ProjectType = 'node' | 'python';

/**
 * Get mock repo path for E2E testing.
 * When TRIKHUB_MOCK_REPOS_FILE is set, looks up the local bare repo path.
 */
function getMockRepoPath(githubRepo: string): string | null {
  const mockReposFile = process.env.TRIKHUB_MOCK_REPOS_FILE;
  if (!mockReposFile) return null;

  try {
    const mapping = JSON.parse(readFileSync(mockReposFile, 'utf-8'));
    return mapping[githubRepo] ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the clone URL for a repo - uses mock path in E2E tests
 */
function getCloneUrl(githubRepo: string): string {
  const mockPath = getMockRepoPath(githubRepo);
  if (mockPath) {
    return mockPath;
  }
  return `https://github.com/${githubRepo}.git`;
}

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
  yes?: boolean;
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
 * Can be skipped with TRIKHUB_SKIP_TAG_CHECK=true (for E2E testing with mock repos)
 */
async function verifyGitHubTagSha(
  githubRepo: string,
  gitTag: string,
  expectedSha: string
): Promise<{ valid: boolean; currentSha?: string }> {
  // Skip verification in test mode
  if (process.env.TRIKHUB_SKIP_TAG_CHECK === 'true') {
    return { valid: true };
  }

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
  const cloneUrl = getCloneUrl(githubRepo);
  const cloneResult = await runCommand(
    'git',
    ['clone', '--depth', '1', '--branch', gitTag, cloneUrl, trikDir],
    baseDir,
    { silent: true }
  );

  if (cloneResult.code !== 0) {
    return { success: false, trikPath: trikDir };
  }

  // Remove .git directory to save space
  await runCommand('rm', ['-rf', join(trikDir, '.git')], baseDir, { silent: true });

  // Write identity file for trusted scoped name
  const identityPath = join(trikDir, '.trikhub-identity.json');
  const identity = {
    scopedName: packageName,
    installedAt: new Date().toISOString(),
  };
  writeFileSync(identityPath, JSON.stringify(identity, null, 2));

  // Install dependencies if package.json exists
  if (existsSync(join(trikDir, 'package.json'))) {
    spinner.text = `Installing dependencies for ${chalk.cyan(packageName)}...`;
    const pm = existsSync(join(trikDir, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : existsSync(join(trikDir, 'yarn.lock'))
        ? 'yarn'
        : 'npm';
    const installArgs = pm === 'pnpm'
      ? ['install', '--frozen-lockfile', '--prod']
      : pm === 'yarn'
        ? ['install', '--production', '--frozen-lockfile']
        : ['install', '--production', '--prefer-offline'];
    const depResult = await runCommand(pm, installArgs, trikDir, { silent: true });
    if (depResult.code !== 0) {
      spinner.warn(`Dependency install failed for ${chalk.cyan(packageName)}`);
      if (depResult.stderr) {
        console.log(chalk.dim(depResult.stderr.slice(0, 500)));
      }
    }
  }

  return { success: true, trikPath: trikDir };
}

/**
 * Resolve a version spec to a concrete TrikVersion, verify its SHA, and return it.
 * Shared by both package-manager and download install paths.
 */
async function resolveAndVerifyVersion(
  trikInfo: { latestVersion: string; githubRepo: string; versions: TrikVersion[] },
  requestedVersion: string | undefined,
  packageName: string,
  spinner: ReturnType<typeof ora>
): Promise<{ version: string; versionInfo: TrikVersion } | null> {
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
      return null;
    }

    versionToInstall = resolvedVersion;
    versionInfo = trikInfo.versions.find((v) => v.version === resolvedVersion);
  } else {
    spinner.fail(`Invalid version: ${chalk.red(requestedVersion)}`);
    return null;
  }

  if (!versionInfo) {
    spinner.fail(`Version ${chalk.red(versionToInstall)} not found for ${packageName}`);
    return null;
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
    return null;
  }

  return { version: versionToInstall, versionInfo };
}

/**
 * Install a trik from TrikHub registry.
 *
 * - usePackageManager: true → installs via npm/pnpm/yarn into node_modules
 * - usePackageManager: false → downloads to .trikhub/triks/ (cross-language or containerized)
 */
async function installFromRegistry(
  packageName: string,
  requestedVersion: string | undefined,
  baseDir: string,
  spinner: ReturnType<typeof ora>,
  options: { usePackageManager: boolean; pm?: PackageManager }
): Promise<{ success: boolean; version?: string; runtime?: TrikRuntime }> {
  spinner.text = `Fetching ${chalk.cyan(packageName)} from TrikHub registry...`;
  const trikInfo = await registry.getTrik(packageName);

  if (!trikInfo) {
    return { success: false };
  }

  const resolved = await resolveAndVerifyVersion(trikInfo, requestedVersion, packageName, spinner);
  if (!resolved) {
    return { success: false };
  }

  const { version: versionToInstall, versionInfo } = resolved;
  let trikPath: string;

  if (options.usePackageManager && options.pm) {
    // Same-runtime, non-containerized: install via package manager into node_modules
    spinner.text = `Removing existing ${chalk.cyan(packageName)} from node_modules...`;
    await removeFromNodeModules(packageName, baseDir);

    const mockPath = getMockRepoPath(trikInfo.githubRepo);
    const gitUrl = mockPath
      ? `git+file://${mockPath}#${versionInfo.gitTag}`
      : `github:${trikInfo.githubRepo}#${versionInfo.gitTag}`;
    spinner.text = `Installing ${chalk.cyan(packageName)}@${versionToInstall}...`;

    const pm = options.pm;
    let installArgs: string[];
    if (pm === 'npm') {
      installArgs = ['install', '--prefix', baseDir, `${packageName}@${gitUrl}`];
    } else if (pm === 'pnpm') {
      installArgs = ['add', `${packageName}@${gitUrl}`];
    } else {
      installArgs = ['add', `${packageName}@${gitUrl}`];
    }

    const installResult = await runCommand(pm, installArgs, baseDir, { silent: true });

    if (installResult.code !== 0) {
      spinner.fail(`Failed to install ${packageName}`);
      console.log(chalk.dim(installResult.stderr));
      return { success: false };
    }

    trikPath = join(baseDir, 'node_modules', ...packageName.split('/'));
  } else {
    // Cross-language or containerized: download to .trikhub/triks/
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

    trikPath = downloadResult.trikPath;
  }

  // Verify installed trik matches its manifest declarations
  const capVerification = await verifyTrikCapabilities(trikPath);
  if (!capVerification.verified) {
    spinner.warn('Capability verification warnings:');
    for (const error of capVerification.errors) {
      console.log(chalk.yellow(`    • ${error}`));
    }
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

/**
 * Read a trik's manifest and return required config entries and trik ID.
 */
async function getRequiredConfig(
  packageName: string,
  baseDir: string,
  isCrossLanguage: boolean
): Promise<{ trikId: string; required: { key: string; description: string }[] }> {
  try {
    let manifestPath: string;

    if (isCrossLanguage) {
      // Cross-language triks are in .trikhub/triks/
      manifestPath = join(baseDir, '.trikhub', 'triks', ...packageName.split('/'), 'manifest.json');
    } else {
      // JS triks are in node_modules/
      manifestPath = join(baseDir, 'node_modules', ...packageName.split('/'), 'manifest.json');
    }

    if (!existsSync(manifestPath)) {
      return { trikId: packageName, required: [] };
    }

    const content = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);
    return {
      trikId: packageName,
      required: manifest.config?.required ?? [],
    };
  } catch {
    return { trikId: packageName, required: [] };
  }
}

/**
 * Ensure .trikhub/secrets.json exists, creating it with placeholder entries
 * for a trik's required config if it doesn't already exist.
 */
async function ensureSecretsJson(
  baseDir: string,
  trikId: string,
  requiredConfig: { key: string; description: string }[]
): Promise<void> {
  const secretsPath = join(baseDir, NPM_CONFIG_DIR, 'secrets.json');

  let secrets: Record<string, Record<string, string>> = {};

  if (existsSync(secretsPath)) {
    try {
      const content = await readFile(secretsPath, 'utf-8');
      secrets = JSON.parse(content);
    } catch {
      // If it's corrupted, we'll overwrite with fresh content
    }
  }

  // Only add placeholder if this trik doesn't already have an entry
  if (!secrets[trikId]) {
    const placeholder: Record<string, string> = {};
    for (const cfg of requiredConfig) {
      placeholder[cfg.key] = `your-${cfg.key}-here`;
    }
    secrets[trikId] = placeholder;

    const configDir = join(baseDir, NPM_CONFIG_DIR);
    if (!existsSync(configDir)) {
      await mkdir(configDir, { recursive: true });
    }
    await writeFile(secretsPath, JSON.stringify(secrets, null, 2) + '\n', 'utf-8');
  }
}

/**
 * Print a hint about required configuration for a trik.
 */
function printConfigHint(
  packageName: string,
  requiredConfig: { key: string; description: string }[],
  trikId?: string
): void {
  console.log();
  console.log(chalk.yellow('  This trik requires configuration:'));
  for (const cfg of requiredConfig) {
    console.log(chalk.yellow(`    - ${cfg.key}: ${cfg.description}`));
  }
  console.log();
  const id = trikId ?? packageName;
  console.log(chalk.dim(`  Update your secrets in .trikhub/secrets.json:`));
  console.log(chalk.dim(`    { "${id}": { ... } }`));
}

const CAPABILITY_DESCRIPTIONS: Record<string, string> = {
  storage: 'Can store persistent data',
  filesystem: 'Can read and write files (runs in Docker container)',
  shell: 'Can execute shell commands (runs in Docker container)',
  trikManagement: 'Can search, install, uninstall, and upgrade triks',
};

/**
 * Display capability warnings and prompt for consent before installing.
 * Returns true if the user consents (or there are no capabilities to warn about).
 */
async function promptCapabilityConsent(
  manifest: TrikManifest,
  githubRepo: string,
  skipPrompt: boolean,
): Promise<boolean> {
  const caps = manifest.capabilities;
  if (!caps) return true;

  const declared: string[] = [];
  if (caps.storage?.enabled) declared.push('storage');
  if (caps.filesystem?.enabled) declared.push('filesystem');
  if (caps.shell?.enabled) declared.push('shell');
  if (caps.trikManagement?.enabled) declared.push('trikManagement');

  // session is low-risk, don't warn about it
  if (declared.length === 0) return true;

  console.log();
  console.log(chalk.yellow('  ⚠️  This trik declares the following capabilities:'));
  console.log();
  for (const cap of declared) {
    const desc = CAPABILITY_DESCRIPTIONS[cap] ?? cap;
    console.log(chalk.yellow(`     • ${cap} — ${desc}`));
  }
  console.log();
  console.log(chalk.dim(`  These capabilities are granted at install time.`));
  console.log(chalk.dim(`  Review the trik source at: github.com/${githubRepo}`));
  console.log();

  if (skipPrompt) return true;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('  Continue? [y/N] ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Verify that a trik's source code matches its manifest capability declarations.
 * Used post-download to detect tampering.
 */
async function verifyTrikCapabilities(trikPath: string): Promise<{ verified: boolean; errors: string[] }> {
  try {
    const manifestRaw = await readFile(join(trikPath, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(manifestRaw);
    const scan = await scanCapabilities(trikPath);
    const errors = crossCheckManifest(scan, manifest);

    if (errors.length === 0) {
      return { verified: true, errors: [] };
    }

    return {
      verified: false,
      errors: errors.map(e => e.message),
    };
  } catch {
    return { verified: false, errors: ['Failed to verify trik capabilities'] };
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
    // For scoped packages (@scope/name@version), the version @ comes after the /
    const atIndex = trikInput.lastIndexOf('@');
    const slashIndex = trikInput.indexOf('/');
    const isVersionSuffix = atIndex > 0 && (!trikInput.startsWith('@') || atIndex > slashIndex);
    if (isVersionSuffix) {
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

      // Check capabilities and prompt for consent before installing
      const targetVersion = versionSpec
        ? trikInfo.versions.find(v => v.version === versionSpec)
        : latestVersion;
      if (targetVersion?.manifest) {
        spinner.stop();
        const consent = await promptCapabilityConsent(
          targetVersion.manifest,
          trikInfo.githubRepo,
          options.yes ?? false,
        );
        if (!consent) {
          console.log(chalk.red('  Installation cancelled.'));
          process.exit(1);
        }
        spinner.start();
      }

      const isCrossLanguage = projectType !== trikRuntime;
      // Containerized triks (filesystem/shell) need a self-contained directory
      // for Docker volume mounts, so they always go to .trikhub/triks/
      const needsContainer = !!(
        targetVersion?.manifest?.capabilities?.filesystem?.enabled ||
        targetVersion?.manifest?.capabilities?.shell?.enabled
      );
      // Python projects always use .trikhub/triks/ download (no npm)
      const useTrikhubDownload = isCrossLanguage || projectType === 'python' || needsContainer;

      const usePackageManager = !useTrikhubDownload;
      const pm = usePackageManager ? detectPackageManager(baseDir) : undefined;

      if (useTrikhubDownload) {
        spinner.info(`Cross-language trik: ${chalk.cyan(trikRuntime)} trik in ${chalk.cyan(projectType)} project`);
        spinner.start(`Installing ${chalk.cyan(packageName)} to .trikhub/triks/...`);
      } else {
        spinner.info(`Found ${chalk.cyan(packageName)} on TrikHub registry`);
      }

      const result = await installFromRegistry(packageName, versionSpec, baseDir, spinner, {
        usePackageManager,
        pm,
      });

      if (!result.success) {
        spinner.fail(`Failed to install ${chalk.red(packageName)}`);
        process.exit(1);
      }

      await addTrikToConfig(packageName, baseDir, result.version, useTrikhubDownload ? trikRuntime : undefined);
      spinner.succeed(`Installed ${chalk.green(packageName)}@${result.version} from TrikHub`);

      console.log();
      if (useTrikhubDownload) {
        console.log(chalk.dim(`  Downloaded to: .trikhub/triks/${packageName}`));
        console.log(chalk.dim(`  Registered in: .trikhub/config.json`));
        console.log();
        if (isCrossLanguage) {
          console.log(chalk.dim('The trik will run via the cross-language worker.'));
        } else {
          console.log(chalk.dim('The trik will be available to your AI agent.'));
        }
      } else {
        console.log(chalk.dim(`  Added to: package.json`));
        console.log(chalk.dim(`  Registered in: .trikhub/config.json`));
        console.log();
        console.log(chalk.dim('The trik will be available to your AI agent.'));
      }

      const configInfo = await getRequiredConfig(packageName, baseDir, useTrikhubDownload);
      if (configInfo.required.length > 0) {
        await ensureSecretsJson(baseDir, configInfo.trikId, configInfo.required);
        printConfigHint(packageName, configInfo.required, configInfo.trikId);
      }
    } else {
      spinner.fail(`${chalk.red(packageName)} not found on TrikHub registry`);
      process.exit(1);
    }

  } catch (error) {
    spinner.fail('Installation failed');
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}
