import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ServerConfig {
  port: number;
  host: string;
  /** Directory for local skill files. Optional if using configPath. */
  skillsDirectory?: string;
  /** Path to .trikhub/config.json for loading npm-installed skills. Defaults to .trikhub/config.json in cwd if it exists. */
  configPath?: string;
  allowedSkills?: string[];
  lintOnLoad: boolean;
  lintWarningsAsErrors: boolean;
  authToken?: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Get the default config path if it exists in cwd
 */
function getDefaultConfigPath(): string | undefined {
  const defaultPath = join(process.cwd(), '.trikhub', 'config.json');
  return existsSync(defaultPath) ? defaultPath : undefined;
}

export function loadConfig(): ServerConfig {
  const allowedSkillsEnv = process.env.ALLOWED_SKILLS;

  // SKILLS_DIR is now optional - only set if explicitly provided
  const skillsDirectory = process.env.SKILLS_DIR;

  // CONFIG_PATH defaults to .trikhub/config.json in cwd if it exists
  const configPath = process.env.CONFIG_PATH || getDefaultConfigPath();

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    skillsDirectory,
    configPath,
    allowedSkills: allowedSkillsEnv ? allowedSkillsEnv.split(',').map((s) => s.trim()) : undefined,
    lintOnLoad: process.env.LINT_ON_LOAD !== 'false',
    lintWarningsAsErrors: process.env.LINT_WARNINGS_AS_ERRORS === 'true',
    authToken: process.env.AUTH_TOKEN,
    logLevel: (process.env.LOG_LEVEL as ServerConfig['logLevel']) || 'info',
  };
}
