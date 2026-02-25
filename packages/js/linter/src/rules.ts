import ts from 'typescript';

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

/**
 * List of forbidden Node.js core modules
 */
export const FORBIDDEN_IMPORTS = [
  'fs',
  'fs/promises',
  'child_process',
  'net',
  'http',
  'https',
  'dgram',
  'dns',
  'tls',
  'cluster',
  'worker_threads',
  'vm',
  'process',
];

/**
 * List of forbidden global function calls
 */
export const FORBIDDEN_CALLS = ['eval', 'Function'];

/**
 * Extract all import specifiers from a source file
 */
export function getImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        imports.push(moduleSpecifier.text);
      }
    }
    // Also check for dynamic imports
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          imports.push(arg.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

/**
 * Check for forbidden imports
 */
export function checkForbiddenImports(
  sourceFile: ts.SourceFile,
  forbiddenList: string[] = FORBIDDEN_IMPORTS
): LintResult[] {
  const results: LintResult[] = [];
  const imports = getImports(sourceFile);

  for (const imp of imports) {
    // Check direct matches and node: prefix
    const normalizedImport = imp.startsWith('node:') ? imp.slice(5) : imp;

    if (forbiddenList.includes(normalizedImport)) {
      results.push({
        rule: 'no-forbidden-imports',
        severity: 'error',
        message: `Forbidden import: "${imp}" - triks cannot use this module`,
        file: sourceFile.fileName,
      });
    }
  }

  return results;
}

/**
 * Check for dynamic code execution (eval, Function constructor)
 */
export function checkDynamicCodeExecution(sourceFile: ts.SourceFile): LintResult[] {
  const results: LintResult[] = [];

  function visit(node: ts.Node) {
    // Check for eval()
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'eval') {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        results.push({
          rule: 'no-dynamic-code',
          severity: 'error',
          message: 'Use of eval() is forbidden in triks',
          file: sourceFile.fileName,
          line: line + 1,
          column: character + 1,
        });
      }
    }

    // Check for new Function()
    if (ts.isNewExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === 'Function') {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        results.push({
          rule: 'no-dynamic-code',
          severity: 'error',
          message: 'Use of Function constructor is forbidden in triks',
          file: sourceFile.fileName,
          line: line + 1,
          column: character + 1,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

/**
 * Find tool usages in the source file
 * This is a heuristic - looks for common LangGraph tool patterns
 */
export function findToolUsage(sourceFile: ts.SourceFile): string[] {
  const tools: string[] = [];

  function visit(node: ts.Node) {
    // Look for @tool decorator or tool() calls
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'tool') {
        // tool("name", ...) pattern
        const firstArg = node.arguments[0];
        if (firstArg && ts.isStringLiteral(firstArg)) {
          tools.push(firstArg.text);
        }
      }
    }

    // Look for StructuredTool class definitions
    if (ts.isClassDeclaration(node)) {
      const heritage = node.heritageClauses;
      if (heritage) {
        for (const clause of heritage) {
          for (const type of clause.types) {
            if (ts.isIdentifier(type.expression) && type.expression.text === 'StructuredTool') {
              // Get the name property
              for (const member of node.members) {
                if (ts.isPropertyDeclaration(member)) {
                  const name = member.name;
                  if (ts.isIdentifier(name) && name.text === 'name') {
                    const initializer = member.initializer;
                    if (initializer && ts.isStringLiteral(initializer)) {
                      tools.push(initializer.text);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return tools;
}

/**
 * Check that all tools used are declared in manifest
 */
export function checkUndeclaredTools(
  sourceFile: ts.SourceFile,
  declaredTools: string[]
): LintResult[] {
  const results: LintResult[] = [];
  const usedTools = findToolUsage(sourceFile);

  for (const tool of usedTools) {
    if (!declaredTools.includes(tool)) {
      results.push({
        rule: 'undeclared-tool',
        severity: 'error',
        message: `Tool "${tool}" is used but not declared in manifest.capabilities.tools`,
        file: sourceFile.fileName,
      });
    }
  }

  return results;
}

/**
 * Check for process.env access (potential secret leakage)
 */
export function checkProcessEnvAccess(sourceFile: ts.SourceFile): LintResult[] {
  const results: LintResult[] = [];

  function visit(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node)) {
      // Check for process.env
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'process' &&
        ts.isIdentifier(node.expression.name) &&
        node.expression.name.text === 'env'
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        results.push({
          rule: 'no-process-env',
          severity: 'warning',
          message: 'Accessing process.env - ensure no secrets are leaked in trik output',
          file: sourceFile.fileName,
          line: line + 1,
          column: character + 1,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}
