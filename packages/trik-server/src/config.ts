export interface ServerConfig {
  port: number;
  host: string;
  skillsDirectory: string;
  /** Path to .trikhub/config.json for loading npm-installed skills */
  configPath?: string;
  allowedSkills?: string[];
  lintOnLoad: boolean;
  lintWarningsAsErrors: boolean;
  authToken?: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(): ServerConfig {
  const allowedSkillsEnv = process.env.ALLOWED_SKILLS;

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    skillsDirectory: process.env.SKILLS_DIR || './skills',
    configPath: process.env.CONFIG_PATH,
    allowedSkills: allowedSkillsEnv ? allowedSkillsEnv.split(',').map((s) => s.trim()) : undefined,
    lintOnLoad: process.env.LINT_ON_LOAD !== 'false',
    lintWarningsAsErrors: process.env.LINT_WARNINGS_AS_ERRORS === 'true',
    authToken: process.env.AUTH_TOKEN,
    logLevel: (process.env.LOG_LEVEL as ServerConfig['logLevel']) || 'info',
  };
}
