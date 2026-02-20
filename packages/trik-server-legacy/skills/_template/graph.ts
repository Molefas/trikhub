interface SkillInput {
  action: string;
  input: unknown;
  session?: {
    sessionId: string;
    history: Array<{ action: string; input: unknown; agentData?: unknown }>;
  };
}

interface SkillOutput {
  responseMode: 'template' | 'passthrough';
  agentData?: unknown;
  userContent?: {
    contentType: string;
    content: string;
    metadata?: Record<string, unknown>;
  };
}

export const graph = {
  async invoke(input: SkillInput): Promise<SkillOutput> {
    const { action, input: actionInput } = input;

    switch (action) {
      case 'hello': {
        const { name } = actionInput as { name: string };
        return {
          responseMode: 'template',
          agentData: {
            template: 'greeting',
            nameLength: name.length,
          },
        };
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  },
};
