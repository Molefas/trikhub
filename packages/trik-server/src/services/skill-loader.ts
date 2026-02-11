import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { TrikGateway } from '@trikhub/gateway';
import { TrikValidator, type ValidationResult } from './skill-validator.js';

export interface SkillLoaderConfig {
  skillsDirectory: string;
  /** Path to .trikhub/config.json for loading npm-installed skills */
  configPath?: string;
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
    this.gateway = new TrikGateway({
      allowedTriks: config.allowedSkills,
    });
    this.validator = new TrikValidator({
      warningsAsErrors: config.lintWarningsAsErrors,
    });
  }

  getGateway(): TrikGateway {
    return this.gateway;
  }

  async discoverSkills(): Promise<string[]> {
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

    // 1. Load from directory (existing behavior)
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
      // Only log if there's no config path either
      if (!this.config.configPath) {
        throw error;
      }
    }

    // 2. Load from config file (npm packages)
    if (this.config.configPath) {
      try {
        const manifests = await this.gateway.loadTriksFromConfig({
          configPath: this.config.configPath,
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
