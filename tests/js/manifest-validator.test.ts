/**
 * Tests for v2 manifest validator — filesystem and shell capability validation.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../../packages/js/manifest/dist/validator.js';

// ============================================================================
// Fixtures
// ============================================================================

function makeConversationalManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    id: 'test-trik',
    name: 'Test Trik',
    description: 'A test trik for unit tests',
    version: '1.0.0',
    agent: {
      mode: 'conversational',
      handoffDescription: 'A test trik that handles test scenarios for validation',
      systemPrompt: 'You are a helpful test assistant.',
      domain: ['testing', 'validation'],
    },
    entry: { module: './dist/index.js', export: 'default' },
    ...overrides,
  };
}

// ============================================================================
// Filesystem capability validation
// ============================================================================

describe('filesystem capability validation', () => {
  it('accepts manifest with filesystem capability', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          filesystem: { enabled: true },
        },
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('accepts filesystem with maxSizeBytes', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          filesystem: { enabled: true, maxSizeBytes: 524288000 },
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts filesystem with enabled: false', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          filesystem: { enabled: false },
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects filesystem without enabled field', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          filesystem: { maxSizeBytes: 1000 },
        },
      }),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects filesystem with non-boolean enabled', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          filesystem: { enabled: 'yes' },
        },
      }),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects filesystem with additional properties', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          filesystem: { enabled: true, unknownProp: true },
        },
      }),
    );
    expect(result.valid).toBe(false);
  });
});

// ============================================================================
// Shell capability validation
// ============================================================================

describe('shell capability validation', () => {
  it('accepts manifest with filesystem + shell', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          filesystem: { enabled: true },
          shell: { enabled: true },
        },
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('accepts shell with timeoutMs and maxConcurrent', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          filesystem: { enabled: true },
          shell: { enabled: true, timeoutMs: 60000, maxConcurrent: 3 },
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects shell without filesystem (semantic)', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          shell: { enabled: true },
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.includes('shell requires filesystem'))).toBe(true);
  });

  it('rejects shell enabled with filesystem disabled', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          filesystem: { enabled: false },
          shell: { enabled: true },
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors!.some((e) => e.includes('shell requires filesystem'))).toBe(true);
  });

  it('accepts shell disabled without filesystem', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          shell: { enabled: false },
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects shell without enabled field', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          filesystem: { enabled: true },
          shell: { timeoutMs: 5000 },
        },
      }),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects shell with additional properties', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          filesystem: { enabled: true },
          shell: { enabled: true, unknownProp: true },
        },
      }),
    );
    expect(result.valid).toBe(false);
  });
});

// ============================================================================
// Regression: existing manifests unaffected
// ============================================================================

describe('regression — existing manifests', () => {
  it('valid conversational manifest without capabilities passes', () => {
    const result = validateManifest(makeConversationalManifest());
    expect(result.valid).toBe(true);
  });

  it('manifest with session + storage capabilities still passes', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          session: { enabled: true },
          storage: { enabled: true },
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('all capabilities together passes', () => {
    const result = validateManifest(
      makeConversationalManifest({
        capabilities: {
          session: { enabled: true },
          storage: { enabled: true },
          filesystem: { enabled: true, maxSizeBytes: 524288000 },
          shell: { enabled: true, timeoutMs: 30000, maxConcurrent: 3 },
        },
      }),
    );
    expect(result.valid).toBe(true);
  });
});
