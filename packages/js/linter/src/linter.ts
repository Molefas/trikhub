import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { constants } from 'node:fs';
import {
  type TrikManifest,
  type ValidationResult,
  validateManifest,
} from '@trikhub/manifest';
import { type ScanResult, scanCapabilities } from './scanner.js';

/**
 * Lint result severity
 */
export type LintSeverity = 'error' | 'warning' | 'info';

/**
 * A single lint result
 */
export interface LintResult {
  rule: string;
  severity: LintSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

type PackageType = 'node' | 'python';

interface ManifestLocation {
  /** Full path to manifest.json */
  manifestPath: string;
  /** Directory containing manifest.json (for resolving entry points) */
  manifestDir: string;
  /** Package type (node or python) */
  packageType: PackageType;
}

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the manifest.json file in a trik repository
 *
 * Node.js packages: manifest.json at root (no pyproject.toml/setup.py)
 * Python packages: manifest.json at root with pyproject.toml/setup.py,
 *                  or manifest.json inside package subdirectory
 */
async function findManifestPath(repoDir: string): Promise<ManifestLocation | null> {
  const hasPyproject = await fileExists(join(repoDir, 'pyproject.toml'));
  const hasSetupPy = await fileExists(join(repoDir, 'setup.py'));

  // Check for manifest.json at root
  const rootManifest = join(repoDir, 'manifest.json');
  if (await fileExists(rootManifest)) {
    // Determine package type: if pyproject.toml/setup.py exists or manifest
    // entry.runtime is "python", treat as Python package
    let packageType: PackageType = 'node';
    if (hasPyproject || hasSetupPy) {
      packageType = 'python';
    } else {
      // Also check manifest entry.runtime as a fallback
      try {
        const content = await readFile(rootManifest, 'utf-8');
        const manifest = JSON.parse(content);
        if (manifest.entry?.runtime === 'python') {
          packageType = 'python';
        }
      } catch {
        // Parse error - default to node
      }
    }
    return {
      manifestPath: rootManifest,
      manifestDir: repoDir,
      packageType,
    };
  }

  // Python package with manifest inside subdirectory
  if (hasPyproject || hasSetupPy) {
    try {
      const entries = await readdir(repoDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_')) {
          const subManifest = join(repoDir, entry.name, 'manifest.json');
          if (await fileExists(subManifest)) {
            return {
              manifestPath: subManifest,
              manifestDir: join(repoDir, entry.name),
              packageType: 'python',
            };
          }
        }
      }
    } catch {
      // Directory read failed
    }
  }

  return null;
}

/**
 * Linter configuration
 */
export interface LinterConfig {
  /** Skip certain rules */
  skipRules?: string[];
  /** Treat warnings as errors */
  warningsAsErrors?: boolean;
  /** Check that compiled entry point exists - used for publish validation */
  checkCompiledEntry?: boolean;
}

// Re-export for use by CLI
export { findManifestPath, type ManifestLocation, type PackageType };

/**
 * Linter for trik validation
 */
export class TrikLinter {
  private config: LinterConfig;

  constructor(config: LinterConfig = {}) {
    this.config = config;
  }

  /**
   * Load and parse the manifest from a specific path.
   * Returns both the manifest (null if invalid) and the full validation result.
   */
  private async loadManifestFromPath(manifestPath: string): Promise<{
    manifest: TrikManifest | null;
    validation: ValidationResult;
  }> {
    const content = await readFile(manifestPath, 'utf-8');
    const data = JSON.parse(content);

    const validation = validateManifest(data);
    if (!validation.valid) {
      return { manifest: null, validation };
    }

    return { manifest: data as TrikManifest, validation };
  }

  /**
   * Check if a rule should be skipped
   */
  private shouldSkipRule(ruleName: string): boolean {
    return this.config.skipRules?.includes(ruleName) ?? false;
  }

  /**
   * Lint only the manifest (for downloaded/compiled triks without TypeScript source)
   *
   * This validates:
   * - Manifest structure and required fields
   *
   * This does NOT validate:
   * - Source code capabilities (handled by scanCapabilities separately)
   */
  async lintManifestOnly(trikPath: string): Promise<LintResult[]> {
    const results: LintResult[] = [];

    // Find manifest (supports both Node.js and Python package structures)
    const location = await findManifestPath(trikPath);
    if (!location) {
      results.push({
        rule: 'valid-manifest',
        severity: 'error',
        message: 'No manifest.json found. For Node.js triks, place it at root. For Python triks, place it inside your package directory.',
        file: trikPath,
      });
      return results;
    }

    const { manifestPath, manifestDir } = location;

    // 1. Load and validate manifest
    let manifest: TrikManifest;
    let validation: ValidationResult;
    try {
      const loaded = await this.loadManifestFromPath(manifestPath);
      validation = loaded.validation;
      if (!loaded.manifest) {
        // Surface each validation error individually with categorized rule names
        for (const err of validation.errors ?? []) {
          results.push({
            rule: this.classifySemanticIssue(err),
            severity: 'error',
            message: err,
            file: manifestPath,
          });
        }
        return results;
      }
      manifest = loaded.manifest;
    } catch (error) {
      results.push({
        rule: 'valid-manifest',
        severity: 'error',
        message: error instanceof Error ? error.message : 'Failed to load manifest',
        file: manifestPath,
      });
      return results;
    }

    // 2. Apply manifest-specific rules (privilege separation)
    results.push(...this.lintManifest(manifest, manifestPath, validation));

    // 3. Check manifest completeness
    if (!this.shouldSkipRule('manifest-completeness')) {
      results.push(...this.checkManifestCompleteness(manifest, manifestDir));
    }

    // 4. Check compiled entry point exists (for publish validation)
    if (this.config.checkCompiledEntry) {
      const entryPath = join(manifestDir, manifest.entry.module);
      if (!(await fileExists(entryPath))) {
        results.push({
          rule: 'entry-point-exists',
          severity: 'error',
          message: `Entry point not found: ${manifest.entry.module}`,
          file: manifestDir,
        });
      }
    }

    // Apply warningsAsErrors if configured
    if (this.config.warningsAsErrors) {
      for (const result of results) {
        if (result.severity === 'warning') {
          result.severity = 'error';
        }
      }
    }

    return results;
  }

  /**
   * Lint a trik — validates manifest and scans source capabilities.
   *
   * Returns manifest validation results and a capability scan result.
   * The scan is informational (security tier A-D) and never blocks.
   * Only manifest TDPS violations produce errors.
   */
  async lint(trikPath: string): Promise<{ results: LintResult[]; scan: ScanResult }> {
    const results: LintResult[] = [];

    // Find manifest (supports both Node.js and Python package structures)
    const location = await findManifestPath(trikPath);
    if (!location) {
      results.push({
        rule: 'valid-manifest',
        severity: 'error',
        message: 'No manifest.json found. For Node.js triks, place it at root. For Python triks, place it inside your package directory.',
        file: trikPath,
      });
      // Return empty scan when no manifest found
      const scan = await scanCapabilities(trikPath);
      return { results, scan };
    }

    const { manifestPath, manifestDir } = location;

    // 1. Load and validate manifest
    let manifest: TrikManifest;
    let validation: ValidationResult;
    try {
      const loaded = await this.loadManifestFromPath(manifestPath);
      validation = loaded.validation;
      if (!loaded.manifest) {
        for (const err of validation.errors ?? []) {
          results.push({
            rule: this.classifySemanticIssue(err),
            severity: 'error',
            message: err,
            file: manifestPath,
          });
        }
        const scan = await scanCapabilities(trikPath);
        return { results, scan };
      }
      manifest = loaded.manifest;
    } catch (error) {
      results.push({
        rule: 'valid-manifest',
        severity: 'error',
        message: error instanceof Error ? error.message : 'Failed to load manifest',
        file: manifestPath,
      });
      const scan = await scanCapabilities(trikPath);
      return { results, scan };
    }

    // 2. Apply manifest-specific rules (privilege separation)
    results.push(...this.lintManifest(manifest, manifestPath, validation));

    // 3. Check manifest completeness
    if (!this.shouldSkipRule('manifest-completeness')) {
      results.push(...this.checkManifestCompleteness(manifest, manifestDir));
    }

    // 4. Check entry point exists (warning, not error)
    const entryPath = join(manifestDir, manifest.entry.module);
    if (!(await fileExists(entryPath))) {
      results.push({
        rule: 'entry-point-exists',
        severity: 'warning',
        message: `Entry point "${manifest.entry.module}" not found`,
        file: manifestDir,
      });
    }

    // 5. Scan source capabilities
    const scan = await scanCapabilities(trikPath);

    // Apply warningsAsErrors if configured
    if (this.config.warningsAsErrors) {
      for (const result of results) {
        if (result.severity === 'warning') {
          result.severity = 'error';
        }
      }
    }

    return { results, scan };
  }

  /**
   * Classify a semantic validation message into a lint rule name.
   * Maps TDPS-related warnings/errors to specific rule categories.
   */
  private classifySemanticIssue(message: string): string {
    const lower = message.toLowerCase();

    // outputSchema agent-safe violations
    if (lower.includes('not agent-safe') || (lower.includes('unconstrained string') && lower.includes('outputschema'))) {
      return 'tdps-agent-safe-output';
    }

    // logSchema constraint violations
    if (lower.includes('logschema') && lower.includes('unconstrained')) {
      return 'tdps-constrained-log';
    }

    // logTemplate placeholder issues
    if (lower.includes('logtemplate') && lower.includes('placeholder')) {
      return 'tdps-log-template';
    }

    // outputTemplate placeholder issues
    if (lower.includes('outputtemplate') && lower.includes('placeholder')) {
      return 'tdps-output-template';
    }

    // Default catch-all for other semantic issues
    return 'manifest-semantic';
  }

  /**
   * Lint manifest with privilege separation rules.
   * Maps validator warnings and errors to categorized lint results.
   */
  private lintManifest(
    _manifest: TrikManifest,
    manifestPath: string,
    validation: ValidationResult,
  ): LintResult[] {
    const results: LintResult[] = [];

    // Surface validation errors as categorized lint results
    if (validation.errors) {
      for (const error of validation.errors) {
        results.push({
          rule: this.classifySemanticIssue(error),
          severity: 'error',
          message: error,
          file: manifestPath,
        });
      }
    }

    // Surface validation warnings as categorized lint results
    if (validation.warnings) {
      for (const warning of validation.warnings) {
        results.push({
          rule: this.classifySemanticIssue(warning),
          severity: 'warning',
          message: warning,
          file: manifestPath,
        });
      }
    }

    return results;
  }

  /**
   * Check manifest has all recommended fields
   */
  private checkManifestCompleteness(manifest: TrikManifest, trikPath: string): LintResult[] {
    const results: LintResult[] = [];
    const manifestPath = join(trikPath, 'manifest.json');

    if (!manifest.author) {
      results.push({
        rule: 'manifest-completeness',
        severity: 'info',
        message: 'Manifest is missing optional "author" field',
        file: manifestPath,
      });
    }

    if (!manifest.repository) {
      results.push({
        rule: 'manifest-completeness',
        severity: 'info',
        message: 'Manifest is missing optional "repository" field',
        file: manifestPath,
      });
    }

    if (!manifest.license) {
      results.push({
        rule: 'manifest-completeness',
        severity: 'info',
        message: 'Manifest is missing optional "license" field',
        file: manifestPath,
      });
    }

    if (manifest.limits && manifest.limits.maxTurnTimeMs > 60000) {
      results.push({
        rule: 'manifest-completeness',
        severity: 'warning',
        message: 'maxTurnTimeMs is very high (>60s) - consider reducing',
        file: manifestPath,
      });
    }

    return results;
  }

  /**
   * Format lint results for console output
   */
  formatResults(results: LintResult[]): string {
    if (results.length === 0) {
      return '✓ No issues found';
    }

    const lines: string[] = [];
    const errors = results.filter((r) => r.severity === 'error');
    const warnings = results.filter((r) => r.severity === 'warning');
    const infos = results.filter((r) => r.severity === 'info');

    for (const result of results) {
      const icon = result.severity === 'error' ? '✗' : result.severity === 'warning' ? '⚠' : 'ℹ';
      const location = result.line ? `${result.file}:${result.line}:${result.column}` : result.file;
      lines.push(`${icon} [${result.rule}] ${result.message}`);
      if (location) {
        lines.push(`  at ${location}`);
      }
    }

    lines.push('');
    lines.push(`${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info`);

    return lines.join('\n');
  }

  /**
   * Check if lint results have any errors
   */
  hasErrors(results: LintResult[]): boolean {
    return results.some((r) => r.severity === 'error');
  }
}
