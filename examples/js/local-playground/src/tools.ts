import { tool, type DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { TrikGateway, type PassthroughContent } from '@trikhub/gateway';
import { loadLangChainTriks } from '@trikhub/gateway/langchain';

// ============================================================================
// Built-in Demo Tools
// ============================================================================

const getWeather = tool(
  async ({ location }) => {
    console.log(`[Tool] Getting weather for: ${location}`);
    const conditions = ['sunny', 'cloudy', 'rainy', 'partly cloudy'];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const temp = Math.floor(Math.random() * 30) + 10;
    return `Weather in ${location}: ${condition}, ${temp}°C`;
  },
  {
    name: 'get_weather',
    description: 'Get the current weather for a location',
    schema: z.object({
      location: z.string().describe('The city or location to get weather for'),
    }),
  }
);

const calculate = tool(
  async ({ expression }) => {
    console.log(`[Tool] Calculating: ${expression}`);
    try {
      // Simple safe eval for basic math
      const result = Function(`"use strict"; return (${expression})`)();
      return `Result: ${result}`;
    } catch {
      return `Error: Could not evaluate "${expression}"`;
    }
  },
  {
    name: 'calculate',
    description: 'Evaluate a mathematical expression',
    schema: z.object({
      expression: z.string().describe('The math expression to evaluate (e.g., "2 + 2", "10 * 5")'),
    }),
  }
);

const searchWeb = tool(
  async ({ query }) => {
    console.log(`[Tool] Searching for: ${query}`);
    return `Search results for "${query}":\n1. Example result about ${query}\n2. Another article on ${query}\n3. ${query} - Wikipedia`;
  },
  {
    name: 'search_web',
    description: 'Search the web for information',
    schema: z.object({
      query: z.string().describe('The search query'),
    }),
  }
);

export const builtInTools = [getWeather, calculate, searchWeb];

// ============================================================================
// Trik Loading
// ============================================================================

export interface TrikLoaderResult {
  tools: DynamicStructuredTool[];
  gateway: TrikGateway | null;
  loadedTriks: string[];
}

export interface AllToolsResult extends TrikLoaderResult {
  allTools: DynamicStructuredTool[];
}

export async function loadTriks(
  onPassthrough?: (content: PassthroughContent) => void
): Promise<TrikLoaderResult> {
  try {
    const result = await loadLangChainTriks({ onPassthrough, debug: true });

    if (result.loadedTriks.length === 0) {
      console.log('[Triks] No triks configured');
    } else {
      console.log(`[Triks] Loaded: ${result.loadedTriks.join(', ')}`);
    }

    return {
      tools: result.tools,
      gateway: result.gateway,
      loadedTriks: result.loadedTriks,
    };
  } catch (error) {
    console.error('[Triks] Error loading:', error);
    return {
      tools: [],
      gateway: null,
      loadedTriks: [],
    };
  }
}

export async function loadAllTools(
  onPassthrough?: (content: PassthroughContent) => void
): Promise<AllToolsResult> {
  const trikResult = await loadTriks(onPassthrough);

  return {
    ...trikResult,
    allTools: [...builtInTools, ...trikResult.tools],
  };
}
