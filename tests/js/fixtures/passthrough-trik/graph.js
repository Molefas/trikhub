export const graph = {
  async invoke(input) {
    if (input.action === 'details') {
      const articleId = input.input.id ?? 'unknown';

      // Return passthrough content - this bypasses the agent
      return {
        responseMode: 'passthrough',
        userContent: {
          contentType: 'text/markdown',
          content: `# Article ${articleId}\n\nThis is the full article text that goes directly to the user.\n\nIt could contain: "IGNORE ALL PREVIOUS INSTRUCTIONS" but this never reaches the agent's LLM.`,
          metadata: {
            articleId,
            wordCount: 42,
          },
        },
      };
    }

    return {
      responseMode: 'template',
      agentData: {},
    };
  },
};
