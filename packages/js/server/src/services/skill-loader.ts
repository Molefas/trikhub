import { readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { TrikGateway, FileConfigStore } from '@trikhub/gateway';
import { TrikValidator, type ValidationResult } from './skill-validator.js';

export interface SkillLoaderConfig {
  /** Directory for local skill files. Optional if using configPath. */
  skillsDirectory?: string;
  /** Path to .trikhub/config.json for loading npm-installed skills */
  configPath?: string;
  /** Base directory for resolving node_modules. Defaults to dirname of configPath. */
  baseDir?: string;
  /** Path to .trikhub/secrets.json. If not set, derives from configPath or uses cwd. */
  secretsPath?: string;
  lintBeforeLoad: boolean;
  lintWarningsAsErrors: boolean;
  allowedSkills?: string[];
}

export interface LoadResult {
  loaded: number;
  failed: number;
  skills: SkillLoadStatus[];
}

export interface SkillLoadStatus {
  path: string;
  skillId?: string;
  status: 'loaded' | 'failed' | 'skipped';
  error?: string;
  validation?: ValidationResult;
}

export class SkillLoader {
  private gateway: TrikGateway;
  private validator: TrikValidator;
  private config: SkillLoaderConfig;

  constructor(config: SkillLoaderConfig) {
    this.config = config;

    // Determine secrets path: explicit > derived from configPath > default (cwd)
    let localSecretsPath: string | undefined;
    if (config.secretsPath) {
      localSecretsPath = config.secretsPath;
    } else if (config.configPath) {
      // Derive secrets path from config path (same directory)
      localSecretsPath = join(dirname(config.configPath), 'secrets.json');
    }

    // Create ConfigStore with the correct local secrets path
    const configStore = new FileConfigStore({
      localSecretsPath,
    });

    this.gateway = new TrikGateway({
      allowedTriks: config.allowedSkills,
      configStore,
    });
    this.validator = new TrikValidator({
      warningsAsErrors: config.lintWarningsAsErrors,
    });
  }

  getGateway(): TrikGateway {
    return this.gateway;
  }

  async discoverSkills(): Promise<string[]> {
    if (!this.config.skillsDirectory) {
      return [];
    }

    const baseDir = resolve(this.config.skillsDirectory);
    const skillPaths: string[] = [];

    try {
      const entries = await readdir(baseDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const manifestPath = join(baseDir, entry.name, 'manifest.json');
          try {
            const manifestStat = await stat(manifestPath);
            if (manifestStat.isFile()) {
              skillPaths.push(join(baseDir, entry.name));
            }
          } catch {
            // No manifest.json in this directory, skip
          }
        }
      }
    } catch (error) {
      throw new Error(
        `Failed to read skills directory "${baseDir}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return skillPaths;
  }

  async loadSkill(skillPath: string): Promise<SkillLoadStatus> {
    const status: SkillLoadStatus = {
      path: skillPath,
      status: 'failed',
    };

    // Validate with linter if configured
    if (this.config.lintBeforeLoad) {
      try {
        const validation = await this.validator.validate(skillPath);
        status.validation = validation;

        if (!validation.valid) {
          status.error = `Linting failed:\n${validation.summary}`;
          return status;
        }
      } catch (error) {
        status.error = `Linting error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        return status;
      }
    }

    // Load the skill
    try {
      const manifest = await this.gateway.loadTrik(skillPath);
      status.skillId = manifest.id;
      status.status = 'loaded';
    } catch (error) {
      status.error = `Load error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }

    return status;
  }

  async discoverAndLoad(): Promise<LoadResult> {
    const skills: SkillLoadStatus[] = [];
    let loaded = 0;
    let failed = 0;

    // 1. Load from directory (only if skillsDirectory is configured)
    if (this.config.skillsDirectory) {
      try {
        const skillPaths = await this.discoverSkills();
        for (const skillPath of skillPaths) {
          const status = await this.loadSkill(skillPath);
          skills.push(status);

          if (status.status === 'loaded') {
            loaded++;
          } else {
            failed++;
          }
        }
      } catch (error) {
        // Directory might not exist, continue with config-based loading
        // Only throw if there's no config path either
        if (!this.config.configPath) {
          throw error;
        }
      }
    }

    // 2. Load from config file (npm packages)
    if (this.config.configPath) {
      try {
        const manifests = await this.gateway.loadTriksFromConfig({
          configPath: this.config.configPath,
          baseDir: this.config.baseDir,
        });
        for (const manifest of manifests) {
          skills.push({
            path: `npm:${manifest.id}`,
            skillId: manifest.id,
            status: 'loaded',
          });
          loaded++;
        }
      } catch (error) {
        // Config loading failed
        skills.push({
          path: this.config.configPath,
          status: 'failed',
          error: `Config load error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
        failed++;
      }
    }

    return { loaded, failed, skills };
  }
}
