export { TrikLinter, type LinterConfig } from './linter.js';
export {
  type LintResult,
  type LintSeverity,
  FORBIDDEN_IMPORTS,
  FORBIDDEN_CALLS,
  getImports,
  checkForbiddenImports,
  checkDynamicCodeExecution,
  checkUndeclaredTools,
  checkProcessEnvAccess,
  findToolUsage,
  // V2 rules
  ALLOWED_AGENT_STRING_FORMATS,
  schemaHasNoUnconstrainedStrings,
  checkNoFreeStringsInAgentData,
  extractTemplatePlaceholders,
  getSchemaFieldNames,
  checkTemplateFieldsExist,
  checkHasResponseTemplates,
  checkDefaultTemplateRecommended,
} from './rules.js';
