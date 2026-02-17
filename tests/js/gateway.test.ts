import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrikGateway } from '../../packages/js/gateway/src/gateway.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('TrikGateway', () => {
  let gateway: TrikGateway;

  beforeEach(() => {
    gateway = new TrikGateway();
  });

  describe('loadTrik', () => {
    // Proves: Gateway can load and register triks with valid manifests
    it('should load a valid trik', async () => {
      const manifest = await gateway.loadTrik(join(__dirname, 'fixtures/template-trik'));

      expect(manifest.id).toBe('template-trik');
      expect(gateway.isLoaded('template-trik')).toBe(true);
    });

    // Proves: Allowlist enforcement - only explicitly allowed triks can be loaded
    it('should reject trik not in allowlist', async () => {
      const restrictedGateway = new TrikGateway({
        allowedTriks: ['other-trik'],
      });

      await expect(
        restrictedGateway.loadTrik(join(__dirname, 'fixtures/template-trik'))
      ).rejects.toThrow('not in the allowlist');
    });
  });

  describe('template mode', () => {
    beforeEach(async () => {
      await gateway.loadTrik(join(__dirname, 'fixtures/template-trik'));
    });

    // Proves: Template mode returns structured agentData (safe for agent reasoning)
    it('should return agentData for template mode actions', async () => {
      const result = await gateway.execute('template-trik', 'search', { topic: 'AI' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.responseMode).toBe('template');
        expect(result.agentData).toBeDefined();
        expect((result.agentData as { count: number }).count).toBe(3);
      }
    });

    // Proves: Agent receives pre-defined template text to fill (not arbitrary trik output)
    it('should include templateText when template is specified', async () => {
      const result = await gateway.execute('template-trik', 'search', { topic: 'AI' });

      expect(result.success).toBe(true);
      if (result.success && result.responseMode === 'template') {
        expect(result.templateText).toBe('Found {{count}} results');
      }
    });

    // Proves: Runtime validation rejects triks returning malformed agentData
    it('should validate agentData against schema', async () => {
      const result = await gateway.execute('template-trik', 'badOutput', {});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('INVALID_OUTPUT');
        expect(result.error).toContain('Invalid agentData');
      }
    });
  });

  describe('passthrough mode', () => {
    beforeEach(async () => {
      await gateway.loadTrik(join(__dirname, 'fixtures/passthrough-trik'));
    });

    // Proves: Passthrough content is NOT exposed to agent - only a reference is returned
    it('should return content reference, not raw content', async () => {
      const result = await gateway.execute('passthrough-trik', 'details', { id: 'article-1' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.responseMode).toBe('passthrough');
        // Passthrough returns a reference, not the content itself
        expect((result as { userContentRef: string }).userContentRef).toBeDefined();
        // Raw content should NOT be directly accessible
        expect((result as { userContent?: unknown }).userContent).toBeUndefined();
      }
    });

    // Proves: Content can be retrieved separately for user display (bypassing agent)
    it('should deliver content via deliverContent()', async () => {
      const result = await gateway.execute('passthrough-trik', 'details', { id: 'article-1' });

      expect(result.success).toBe(true);
      if (result.success && result.responseMode === 'passthrough') {
        const ref = (result as { userContentRef: string }).userContentRef;
        const delivery = gateway.deliverContent(ref);

        expect(delivery).not.toBeNull();
        expect(delivery!.content.content).toContain('Article article-1');
        expect(delivery!.content.contentType).toBe('text/markdown');
      }
    });

    // Proves: Content references are single-use (prevents replay attacks)
    it('should only allow one-time delivery', async () => {
      const result = await gateway.execute('passthrough-trik', 'details', { id: 'article-1' });

      if (result.success && result.responseMode === 'passthrough') {
        const ref = (result as { userContentRef: string }).userContentRef;

        // First delivery works
        const firstDelivery = gateway.deliverContent(ref);
        expect(firstDelivery).not.toBeNull();

        // Second delivery returns null (already delivered)
        const secondDelivery = gateway.deliverContent(ref);
        expect(secondDelivery).toBeNull();
      }
    });
  });

  describe('input validation', () => {
    beforeEach(async () => {
      await gateway.loadTrik(join(__dirname, 'fixtures/passthrough-trik'));
    });

    // Proves: Input schema validation prevents malformed requests from reaching triks
    it('should reject input not matching schema', async () => {
      // 'id' is required but not provided
      const result = await gateway.execute('passthrough-trik', 'details', {});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('INVALID_INPUT');
      }
    });

    // Proves: Only declared actions can be invoked (no arbitrary trik method calls)
    it('should reject unknown action', async () => {
      const result = await gateway.execute('passthrough-trik', 'unknown-action', {});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('INVALID_INPUT');
        expect(result.error).toContain('not found');
      }
    });
  });

  describe('session management', () => {
    beforeEach(async () => {
      await gateway.loadTrik(join(__dirname, 'fixtures/passthrough-trik'));
    });

    // Proves: Session-enabled triks get unique session identifiers
    it('should create session for session-enabled triks', async () => {
      const result = await gateway.execute('passthrough-trik', 'details', { id: 'article-1' });

      expect(result.success).toBe(true);
      expect((result as { sessionId?: string }).sessionId).toBeDefined();
    });

    // Proves: Sessions persist across multiple calls for stateful interactions
    it('should maintain session across calls', async () => {
      const r1 = await gateway.execute('passthrough-trik', 'details', { id: 'article-1' });

      expect(r1.success).toBe(true);
      const sessionId = (r1 as { sessionId?: string }).sessionId;
      expect(sessionId).toBeDefined();

      // Second call with same session
      const r2 = await gateway.execute('passthrough-trik', 'details', { id: 'article-2' }, {
        sessionId,
      });

      expect(r2.success).toBe(true);
      expect((r2 as { sessionId?: string }).sessionId).toBe(sessionId);
    });
  });

  describe('trik not loaded', () => {
    // Proves: Gateway rejects execution of unregistered triks
    it('should return error for unloaded trik', async () => {
      const result = await gateway.execute('nonexistent-trik', 'action', {});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('TRIK_NOT_FOUND');
      }
    });
  });

  describe('resolveTemplate', () => {
    // Proves: Template resolution only substitutes known placeholders from agentData
    it('should replace placeholders with agentData values', () => {
      const template = { text: 'Found {{count}} articles about {{topic}}' };
      const agentData = { count: 5, topic: 'AI' };

      const resolved = gateway.resolveTemplate(template, agentData);

      expect(resolved).toBe('Found 5 articles about AI');
    });

    // Proves: Unknown placeholders are preserved (fail-safe, not fail-open)
    it('should preserve unreplaced placeholders', () => {
      const template = { text: 'Count: {{count}}, Missing: {{unknown}}' };
      const agentData = { count: 5 };

      const resolved = gateway.resolveTemplate(template, agentData);

      expect(resolved).toBe('Count: 5, Missing: {{unknown}}');
    });
  });
});
