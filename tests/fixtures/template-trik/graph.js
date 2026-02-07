export const graph = {
  async invoke(input) {
    if (input.action === 'search') {
      return {
        responseMode: 'template',
        agentData: {
          count: 3,
          template: 'success',
        },
      };
    }

    if (input.action === 'badOutput') {
      // Return invalid output - count should be integer but we return string
      return {
        responseMode: 'template',
        agentData: {
          count: 'not-a-number', // Invalid - schema requires integer
        },
      };
    }

    return {
      responseMode: 'template',
      agentData: { count: 0, template: 'empty' },
    };
  },
};
