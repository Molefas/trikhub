import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import ts from 'typescript';
import {
  type SkillManifest,
  validateManifest,
} from '@saaas-poc/skill-manifest';
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
}

/**
 * Linter for skill validation
 */
export class SkillLinter {
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
   * Load and parse the manifest
   */
  private async loadManifest(skillPath: string): Promise<SkillManifest> {
    const manifestPath = join(skillPath, 'manifest.json');
    const content = await readFile(manifestPath, 'utf-8');
    const data = JSON.parse(content);

    const validation = validateManifest(data);
    if (!validation.valid) {
      throw new Error(`Invalid manifest: ${validation.errors?.join(', ')}`);
    }

    return data as SkillManifest;
  }

  /**
   * Find all TypeScript files in the skill directory
   */
  private async findSourceFiles(skillPath: string): Promise<string[]> {
    const fs = await import('node:fs/promises');
    const entries = await fs.readdir(skillPath, { withFileTypes: true });

    const tsFiles: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        // Skip test files and declaration files
        if (!entry.name.includes('.test.') && !entry.name.includes('.spec.') && !entry.name.endsWith('.d.ts')) {
          tsFiles.push(join(skillPath, entry.name));
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
   * Lint a skill
   */
  async lint(skillPath: string): Promise<LintResult[]> {
    const results: LintResult[] = [];
    const manifestPath = join(skillPath, 'manifest.json');

    // 1. Load and validate manifest
    let manifest: SkillManifest;
    try {
      manifest = await this.loadManifest(skillPath);
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
      results.push(...this.checkManifestCompleteness(manifest, skillPath));
    }

    // 4. Find and analyze source files
    const sourceFiles = await this.findSourceFiles(skillPath);

    if (sourceFiles.length === 0) {
      results.push({
        rule: 'has-source-files',
        severity: 'error',
        message: 'No TypeScript source files found in skill directory',
        file: skillPath,
      });
      return results;
    }

    // 5. Check entry point exists
    const entryPath = join(skillPath, manifest.entry.module.replace('.js', '.ts'));
    if (!sourceFiles.some((f) => f.endsWith(entryPath.split('/').pop()!.replace('.js', '.ts')))) {
      results.push({
        rule: 'entry-point-exists',
        severity: 'warning',
        message: `Entry point "${manifest.entry.module}" not found as TypeScript source`,
        file: skillPath,
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
  private lintManifest(manifest: SkillManifest, manifestPath: string): LintResult[] {
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
  private checkManifestCompleteness(manifest: SkillManifest, skillPath: string): LintResult[] {
    const results: LintResult[] = [];
    const manifestPath = join(skillPath, 'manifest.json');

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
