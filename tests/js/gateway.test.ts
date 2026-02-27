/**
 * Tests for TrikGateway — TDPS log value validation and error sanitization.
 */
import { describe, it, expect } from 'vitest';
import { TrikGateway } from '../../packages/js/gateway/dist/gateway.js';

// Access private methods via prototype for testing
const gateway = new TrikGateway();

// Helper to call private validateLogValue
function validateLogValue(value: unknown, fieldSchema: Record<string, unknown>): string | null {
  return (gateway as any).validateLogValue(value, fieldSchema);
}

// Helper to call private buildToolLogSummary
function buildToolLogSummary(
  call: { tool: string; input: Record<string, unknown>; output: Record<string, unknown> },
  toolDecl?: Record<string, unknown>,
): string {
  return (gateway as any).buildToolLogSummary(call, toolDecl);
}

// Helper to call private sanitizeErrorMessage
function sanitizeErrorMessage(msg: string, maxLength?: number): string {
  return (gateway as any).sanitizeErrorMessage(msg, maxLength);
}

// ============================================================================
// Gap 1: validateLogValue
// ============================================================================

describe('validateLogValue', () => {
  it('accepts valid integers', () => {
    expect(validateLogValue(42, { type: 'integer' })).toBe('42');
  });

  it('rejects non-integer for integer schema', () => {
    expect(validateLogValue('hello', { type: 'integer' })).toBeNull();
    expect(validateLogValue(3.14, { type: 'integer' })).toBeNull();
  });

  it('accepts valid numbers', () => {
    expect(validateLogValue(3.14, { type: 'number' })).toBe('3.14');
    expect(validateLogValue(42, { type: 'number' })).toBe('42');
  });

  it('rejects non-number for number schema', () => {
    expect(validateLogValue('hello', { type: 'number' })).toBeNull();
  });

  it('accepts valid booleans', () => {
    expect(validateLogValue(true, { type: 'boolean' })).toBe('true');
    expect(validateLogValue(false, { type: 'boolean' })).toBe('false');
  });

  it('rejects non-boolean for boolean schema', () => {
    expect(validateLogValue('true', { type: 'boolean' })).toBeNull();
  });

  it('accepts enum values', () => {
    expect(validateLogValue('success', { enum: ['success', 'failure'] })).toBe('success');
  });

  it('rejects non-enum values', () => {
    expect(validateLogValue('unknown', { enum: ['success', 'failure'] })).toBeNull();
  });

  it('truncates strings at maxLength', () => {
    const result = validateLogValue('a'.repeat(500), { type: 'string', maxLength: 100 });
    expect(result).toBe('a'.repeat(100));
  });

  it('accepts strings within maxLength', () => {
    expect(validateLogValue('short', { type: 'string', maxLength: 100 })).toBe('short');
  });

  it('accepts strings matching pattern', () => {
    expect(validateLogValue('abc123', { type: 'string', pattern: '^[a-z0-9]+$' })).toBe('abc123');
  });

  it('rejects strings not matching pattern', () => {
    expect(validateLogValue('ABC!!!', { type: 'string', pattern: '^[a-z0-9]+$' })).toBeNull();
  });

  it('accepts strings with format', () => {
    expect(validateLogValue('2025-01-01', { type: 'string', format: 'date' })).toBe('2025-01-01');
  });

  it('rejects unconstrained strings', () => {
    expect(validateLogValue('anything', { type: 'string' })).toBeNull();
  });

  it('rejects unknown types', () => {
    expect(validateLogValue({}, { type: 'object' })).toBeNull();
    expect(validateLogValue([], { type: 'array' })).toBeNull();
  });

  it('returns null for null/undefined values', () => {
    expect(validateLogValue(null, { type: 'string', maxLength: 100 })).toBeNull();
    expect(validateLogValue(undefined, { type: 'string', maxLength: 100 })).toBeNull();
  });

  it('rejects string value for integer schema', () => {
    expect(validateLogValue('42', { type: 'integer' })).toBeNull();
  });
});

// ============================================================================
// Gap 1: buildToolLogSummary
// ============================================================================

describe('buildToolLogSummary', () => {
  it('returns generic message when no logTemplate', () => {
    const result = buildToolLogSummary(
      { tool: 'search', input: {}, output: {} },
      { description: 'Search' },
    );
    expect(result).toBe('Called search');
  });

  it('returns generic message when no toolDecl', () => {
    const result = buildToolLogSummary(
      { tool: 'search', input: {}, output: {} },
      undefined,
    );
    expect(result).toBe('Called search');
  });

  it('fills validated placeholders from logSchema', () => {
    const result = buildToolLogSummary(
      { tool: 'search', input: {}, output: { query: 'test', count: 5 } },
      {
        description: 'Search',
        logTemplate: 'Searched for "{{query}}" — {{count}} results',
        logSchema: {
          query: { type: 'string', maxLength: 200 },
          count: { type: 'integer' },
        },
      },
    );
    expect(result).toBe('Searched for "test" — 5 results');
  });

  it('uses literal placeholder for missing logSchema field', () => {
    const result = buildToolLogSummary(
      { tool: 'search', input: {}, output: { query: 'test' } },
      {
        description: 'Search',
        logTemplate: 'Searched for "{{query}}" — {{count}} results',
        logSchema: {
          query: { type: 'string', maxLength: 200 },
          // count not in logSchema
        },
      },
    );
    expect(result).toBe('Searched for "test" — {{count}} results');
  });

  it('uses literal placeholder for non-conforming values', () => {
    const result = buildToolLogSummary(
      { tool: 'search', input: {}, output: { status: 'INJECTION_ATTEMPT' } },
      {
        description: 'Search',
        logTemplate: 'Status: {{status}}',
        logSchema: {
          status: { type: 'string', enum: ['success', 'failure'] },
        },
      },
    );
    expect(result).toBe('Status: {{status}}');
  });

  it('truncates long strings to maxLength', () => {
    const longValue = 'x'.repeat(500);
    const result = buildToolLogSummary(
      { tool: 'log', input: {}, output: { msg: longValue } },
      {
        description: 'Log',
        logTemplate: 'Message: {{msg}}',
        logSchema: {
          msg: { type: 'string', maxLength: 100 },
        },
      },
    );
    expect(result).toBe('Message: ' + 'x'.repeat(100));
  });

  it('uses literal placeholder when logSchema is missing entirely', () => {
    const result = buildToolLogSummary(
      { tool: 'search', input: {}, output: { query: 'test' } },
      {
        description: 'Search',
        logTemplate: 'Searched for "{{query}}"',
        // no logSchema at all
      },
    );
    expect(result).toBe('Searched for "{{query}}"');
  });
});

// ============================================================================
// Gap 2: sanitizeErrorMessage
// ============================================================================

describe('sanitizeErrorMessage', () => {
  it('passes through short clean messages', () => {
    expect(sanitizeErrorMessage('Something failed')).toBe('Something failed');
  });

  it('truncates long messages', () => {
    const longMsg = 'x'.repeat(500);
    const result = sanitizeErrorMessage(longMsg);
    expect(result.length).toBe(203); // 200 + "..."
    expect(result.endsWith('...')).toBe(true);
  });

  it('truncates at custom maxLength', () => {
    const result = sanitizeErrorMessage('abcdefghij', 5);
    expect(result).toBe('abcde...');
  });

  it('strips control characters but keeps newlines and tabs', () => {
    const msg = 'hello\x00world\x01\nline2\ttab';
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe('helloworld\nline2\ttab');
  });
});
