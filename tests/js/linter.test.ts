/**
 * Tests for TrikLinter — TDPS rule surfacing from manifest validation.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { TrikLinter } from '../../packages/js/linter/dist/linter.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), `linter-test-${Date.now()}`);

async function writeTrik(name: string, manifest: Record<string, unknown>): Promise<string> {
  const trikDir = join(testDir, name);
  await mkdir(trikDir, { recursive: true });
  await writeFile(join(trikDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // Create a dummy entry point
  await mkdir(join(trikDir, 'src'), { recursive: true });
  await writeFile(join(trikDir, 'src', 'index.ts'), 'export default {};');
  return trikDir;
}

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ============================================================================
// Gap 3: TDPS rules surfaced in linter output
// ============================================================================

describe('lintManifest TDPS rules', () => {
  it('surfaces tdps-agent-safe-output for unconstrained outputSchema strings', async () => {
    const trikDir = await writeTrik('bad-output', {
      schemaVersion: 2,
      id: 'bad-output',
      name: 'Bad Output',
      description: 'A tool-mode trik with unconstrained output',
      version: '1.0.0',
      agent: { mode: 'tool', domain: ['test'] },
      tools: {
        myTool: {
          description: 'Does stuff',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
          outputSchema: {
            type: 'object',
            properties: {
              result: { type: 'string' }, // unconstrained — should trigger tdps-agent-safe-output
            },
          },
          outputTemplate: 'Result: {{result}}',
        },
      },
      entry: { module: 'src/index.js', export: 'default' },
    });

    const linter = new TrikLinter();
    const results = await linter.lintManifestOnly(trikDir);

    const tdpsErrors = results.filter((r) => r.rule === 'tdps-agent-safe-output');
    expect(tdpsErrors.length).toBeGreaterThan(0);
    expect(tdpsErrors[0].severity).toBe('error');
  });

  it('surfaces tdps-constrained-log for unconstrained logSchema strings', async () => {
    const trikDir = await writeTrik('bad-log', {
      schemaVersion: 2,
      id: 'bad-log',
      name: 'Bad Log',
      description: 'A conversational trik with unconstrained logSchema',
      version: '1.0.0',
      agent: {
        mode: 'conversational',
        handoffDescription: 'Talk to bad-log agent for testing',
        systemPrompt: 'You are a test agent.',
        domain: ['test'],
      },
      tools: {
        search: {
          description: 'Search for things',
          logTemplate: 'Searched: {{query}}',
          logSchema: {
            query: { type: 'string' }, // unconstrained — should trigger tdps-constrained-log
          },
        },
      },
      entry: { module: 'src/index.js', export: 'default' },
    });

    const linter = new TrikLinter();
    const results = await linter.lintManifestOnly(trikDir);

    const tdpsErrors = results.filter((r) => r.rule === 'tdps-constrained-log');
    expect(tdpsErrors.length).toBeGreaterThan(0);
    expect(tdpsErrors[0].severity).toBe('error');
  });

  it('produces no TDPS errors for a valid manifest', async () => {
    const trikDir = await writeTrik('valid-trik', {
      schemaVersion: 2,
      id: 'valid-trik',
      name: 'Valid Trik',
      description: 'A properly constrained tool-mode trik',
      version: '1.0.0',
      agent: { mode: 'tool', domain: ['test'] },
      tools: {
        myTool: {
          description: 'Does stuff safely',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
          outputSchema: {
            type: 'object',
            properties: {
              result: { type: 'string', enum: ['success', 'failure'] }, // constrained — safe
            },
          },
          outputTemplate: 'Result: {{result}}',
        },
      },
      entry: { module: 'src/index.js', export: 'default' },
    });

    const linter = new TrikLinter();
    const results = await linter.lintManifestOnly(trikDir);

    const tdpsErrors = results.filter((r) =>
      r.rule.startsWith('tdps-') && r.severity === 'error'
    );
    expect(tdpsErrors.length).toBe(0);
  });

  it('classifies logTemplate placeholder errors correctly', async () => {
    const trikDir = await writeTrik('bad-template', {
      schemaVersion: 2,
      id: 'bad-template',
      name: 'Bad Template',
      description: 'A conversational trik with missing logSchema entry',
      version: '1.0.0',
      agent: {
        mode: 'conversational',
        handoffDescription: 'Talk to bad-template agent for testing',
        systemPrompt: 'You are a test agent.',
        domain: ['test'],
      },
      tools: {
        search: {
          description: 'Search things',
          logTemplate: 'Searched: {{query}} got {{count}}',
          logSchema: {
            query: { type: 'string', maxLength: 100 },
            // count is missing — should trigger tdps-log-template
          },
        },
      },
      entry: { module: 'src/index.js', export: 'default' },
    });

    const linter = new TrikLinter();
    const results = await linter.lintManifestOnly(trikDir);

    const templateErrors = results.filter((r) => r.rule === 'tdps-log-template');
    expect(templateErrors.length).toBeGreaterThan(0);
  });
});
