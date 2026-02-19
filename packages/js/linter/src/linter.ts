import { readFile, readdir, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { constants } from 'node:fs';
import ts from 'typescript';
import {
  type TrikManifest,
  validateManifest,
} from '@trikhub/manifest';
import {
  type LintResult,
  checkForbiddenImports,
  checkDynamicCodeExecution,
  checkUndeclaredTools,
  checkProcessEnvAccess,
  // Privilege separation rules
  checkNoFreeStringsInAgentData,
  checkTemplateFieldsExist,
  checkHasResponseTemplates,
  checkDefaultTemplateRecommended,
} from './rules.js';

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
 * Node.js packages: manifest.json at root
 * Python packages: manifest.json inside package subdirectory
 */
async function findManifestPath(repoDir: string): Promise<ManifestLocation | null> {
  // First, check for manifest.json at root (Node.js pattern)
  const rootManifest = join(repoDir, 'manifest.json');
  if (await fileExists(rootManifest)) {
    return {
      manifestPath: rootManifest,
      manifestDir: repoDir,
      packageType: 'node',
    };
  }

  // Check if this is a Python package (has pyproject.toml or setup.py)
  const hasPyproject = await fileExists(join(repoDir, 'pyproject.toml'));
  const hasSetupPy = await fileExists(join(repoDir, 'setup.py'));

  if (hasPyproject || hasSetupPy) {
    // Python package: search subdirectories for manifest.json
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
  /** Additional forbidden imports */
  forbiddenImports?: string[];
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
   * Parse a TypeScript file into a source file
   */
  private parseTypeScript(filePath: string, content: string): ts.SourceFile {
    return ts.createSourceFile(filePath, content, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  }

  /**
   * Load and parse the manifest from a specific path
   */
  private async loadManifestFromPath(manifestPath: string): Promise<TrikManifest> {
    const content = await readFile(manifestPath, 'utf-8');
    const data = JSON.parse(content);

    const validation = validateManifest(data);
    if (!validation.valid) {
      throw new Error(`Invalid manifest: ${validation.errors?.join(', ')}`);
    }

    return data as TrikManifest;
  }

  /**
   * Find all TypeScript files in the trik directory
   */
  private async findSourceFiles(trikPath: string): Promise<string[]> {
    const fs = await import('node:fs/promises');
    const entries = await fs.readdir(trikPath, { withFileTypes: true });

    const tsFiles: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        // Skip test files and declaration files
        if (!entry.name.includes('.test.') && !entry.name.includes('.spec.') && !entry.name.endsWith('.d.ts')) {
          tsFiles.push(join(trikPath, entry.name));
        }
      }
    }

    return tsFiles;
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
   * - Privilege separation rules (no free strings in agentData)
   * - Template field existence
   * - Response templates presence
   *
   * This does NOT validate:
   * - Source code (forbidden imports, eval, etc.)
   * - Entry point existence as TypeScript
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
    try {
      manifest = await this.loadManifestFromPath(manifestPath);
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
    results.push(...this.lintManifest(manifest, manifestPath));

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
   * Lint a trik
   */
  async lint(trikPath: string): Promise<LintResult[]> {
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

    const { manifestPath, manifestDir, packageType } = location;

    // 1. Load and validate manifest
    let manifest: TrikManifest;
    try {
      manifest = await this.loadManifestFromPath(manifestPath);
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
    results.push(...this.lintManifest(manifest, manifestPath));

    // 3. Check manifest completeness
    if (!this.shouldSkipRule('manifest-completeness')) {
      results.push(...this.checkManifestCompleteness(manifest, manifestDir));
    }

    // 4. For Python packages, skip TypeScript source analysis
    if (packageType === 'python') {
      // Check entry point exists
      const entryPath = join(manifestDir, manifest.entry.module);
      if (!(await fileExists(entryPath))) {
        results.push({
          rule: 'entry-point-exists',
          severity: 'error',
          message: `Entry point "${manifest.entry.module}" not found`,
          file: manifestDir,
        });
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

    // 5. Find and analyze TypeScript source files (Node.js packages only)
    const sourceFiles = await this.findSourceFiles(trikPath);

    if (sourceFiles.length === 0) {
      results.push({
        rule: 'has-source-files',
        severity: 'error',
        message: 'No TypeScript source files found in trik directory',
        file: trikPath,
      });
      return results;
    }

    // 6. Check entry point exists
    const entryPath = join(trikPath, manifest.entry.module.replace('.js', '.ts'));
    if (!sourceFiles.some((f) => f.endsWith(entryPath.split('/').pop()!.replace('.js', '.ts')))) {
      results.push({
        rule: 'entry-point-exists',
        severity: 'warning',
        message: `Entry point "${manifest.entry.module}" not found as TypeScript source`,
        file: trikPath,
      });
    }

    // 6. Analyze each source file
    for (const filePath of sourceFiles) {
      const content = await readFile(filePath, 'utf-8');
      const sourceFile = this.parseTypeScript(filePath, content);

      // Check forbidden imports
      if (!this.shouldSkipRule('no-forbidden-imports')) {
        results.push(...checkForbiddenImports(sourceFile, this.config.forbiddenImports));
      }

      // Check dynamic code execution
      if (!this.shouldSkipRule('no-dynamic-code')) {
        results.push(...checkDynamicCodeExecution(sourceFile));
      }

      // Check undeclared tools
      if (!this.shouldSkipRule('undeclared-tool')) {
        results.push(...checkUndeclaredTools(sourceFile, manifest.capabilities.tools));
      }

      // Check process.env access
      if (!this.shouldSkipRule('no-process-env')) {
        results.push(...checkProcessEnvAccess(sourceFile));
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
   * Lint manifest with privilege separation rules
   */
  private lintManifest(manifest: TrikManifest, manifestPath: string): LintResult[] {
    const results: LintResult[] = [];

    // Core security rule: no free-form strings in agentDataSchema
    if (!this.shouldSkipRule('no-free-strings-in-agent-data')) {
      results.push(...checkNoFreeStringsInAgentData(manifest, manifestPath));
    }

    // Validate template placeholders reference real fields
    if (!this.shouldSkipRule('template-fields-exist')) {
      results.push(...checkTemplateFieldsExist(manifest, manifestPath));
    }

    // Ensure actions have response templates
    if (!this.shouldSkipRule('has-response-templates')) {
      results.push(...checkHasResponseTemplates(manifest, manifestPath));
    }

    // Recommend having a default/success template
    if (!this.shouldSkipRule('default-template-recommended')) {
      results.push(...checkDefaultTemplateRecommended(manifest, manifestPath));
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

    if (manifest.limits.maxExecutionTimeMs > 60000) {
      results.push({
        rule: 'manifest-completeness',
        severity: 'warning',
        message: 'maxExecutionTimeMs is very high (>60s) - consider reducing',
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
