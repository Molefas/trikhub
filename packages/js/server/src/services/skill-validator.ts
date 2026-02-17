import { TrikLinter, type LintResult, type LinterConfig } from '@trikhub/linter';

export interface ValidationResult {
  valid: boolean;
  results: LintResult[];
  summary: string;
}

export class TrikValidator {
  private linter: TrikLinter;

  constructor(config: LinterConfig = {}) {
    this.linter = new TrikLinter(config);
  }

  async validate(trikPath: string): Promise<ValidationResult> {
    const results = await this.linter.lint(trikPath);
    const hasErrors = this.linter.hasErrors(results);

    return {
      valid: !hasErrors,
      results,
      summary: this.linter.formatResults(results),
    };
  }
}
