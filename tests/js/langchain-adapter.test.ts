import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrikGateway } from '../packages/js/trik-gateway/src/gateway.js';
import { createLangChainTools } from '../packages/js/trik-gateway/src/langchain/adapter.js';
import type { PassthroughContent } from '@trikhub/manifest';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('LangChain Adapter Security', () => {
  let gateway: TrikGateway;

  beforeEach(async () => {
    gateway = new TrikGateway();
    await gateway.loadTrik(join(__dirname, 'fixtures/passthrough-trik'));
    await gateway.loadTrik(join(__dirname, 'fixtures/template-trik'));
  });

  describe('passthrough response shape', () => {
    /**
     * SECURITY TEST: Passthrough content must NOT leak to the agent.
     *
     * The tool response returned to the LLM agent should ONLY contain
     * safe, structured fields. Any additional fields could expose
     * passthrough content to the agent, enabling prompt injection.
     */
    it('should return ONLY success and response fields for passthrough mode', async () => {
      let passthroughCalled = false;
      let deliveredContent: PassthroughContent | null = null;

      const tools = createLangChainTools(gateway, {
        onPassthrough: (content) => {
          passthroughCalled = true;
          deliveredContent = content;
        },
      });

      // Find the passthrough tool
      const detailsTool = tools.find((t) => t.name.includes('details'));
      expect(detailsTool).toBeDefined();

      // Execute the tool
      const result = await detailsTool!.invoke({ id: 'article-1' });
      const parsed = JSON.parse(result);

      // SECURITY ASSERTION: Only allowed fields in response
      const allowedFields = ['success', 'response'];
      const actualFields = Object.keys(parsed);

      expect(actualFields.sort()).toEqual(allowedFields.sort());

      // Explicitly verify no content leak fields exist
      expect(parsed._directOutput).toBeUndefined();
      expect(parsed.content).toBeUndefined();
      expect(parsed.userContent).toBeUndefined();
      expect(parsed.rawContent).toBeUndefined();
      expect(parsed.data).toBeUndefined();

      // The passthrough callback should have received the content
      expect(passthroughCalled).toBe(true);
      expect(deliveredContent).not.toBeNull();
      expect(deliveredContent!.content).toContain('Article article-1');
    });

    /**
     * SECURITY TEST: Response message should not contain passthrough content.
     *
     * Even the 'response' string field should not include any part of
     * the passthrough content that could influence agent behavior.
     */
    it('should return a generic message, not passthrough content', async () => {
      const tools = createLangChainTools(gateway, {
        onPassthrough: () => {},
      });

      const detailsTool = tools.find((t) => t.name.includes('details'));
      const result = await detailsTool!.invoke({ id: 'article-1' });
      const parsed = JSON.parse(result);

      // Response should be generic acknowledgment
      expect(parsed.response).toBe('Delivered directly to the user');

      // Response should NOT contain article content
      expect(parsed.response).not.toContain('Article');
      expect(parsed.response).not.toContain('article-1');
    });
  });

  describe('template response shape', () => {
    /**
     * Template mode responses are allowed to contain agentData because
     * the linter enforces that agentData contains no free-form strings.
     */
    it('should return structured data for template mode', async () => {
      const tools = createLangChainTools(gateway, {});

      // Find the template tool
      const searchTool = tools.find((t) => t.name.includes('search'));
      expect(searchTool).toBeDefined();

      // Execute the tool
      const result = await searchTool!.invoke({ topic: 'AI' });
      const parsed = JSON.parse(result);

      // Template mode returns success and response (filled template or JSON)
      expect(parsed.success).toBe(true);
      expect(parsed.response).toBeDefined();

      // No passthrough content fields
      expect(parsed._directOutput).toBeUndefined();
      expect(parsed.userContent).toBeUndefined();
    });
  });

  describe('error response shape', () => {
    /**
     * Error responses from gateway failures should not leak content.
     */
    it('should return only success and error fields for gateway errors', async () => {
      // Use the template-trik's badOutput action which returns invalid agentData
      const tools = createLangChainTools(gateway, {});

      const badOutputTool = tools.find((t) => t.name.includes('badOutput'));
      expect(badOutputTool).toBeDefined();

      const result = await badOutputTool!.invoke({});
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toBeDefined();

      // Only allowed error fields - no content leak
      const actualFields = Object.keys(parsed);
      expect(actualFields.sort()).toEqual(['error', 'success']);

      // Error message should not contain raw content
      expect(parsed._directOutput).toBeUndefined();
      expect(parsed.content).toBeUndefined();
    });
  });
});
