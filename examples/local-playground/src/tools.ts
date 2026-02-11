import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { TrikGateway, type PassthroughContent } from "@trikhub/gateway";
import { loadLangChainTriks } from "@trikhub/gateway/langchain";

// ============================================================================
// Built-in Tools
// ============================================================================

const requestRefund = tool(
  async ({ orderId, reason }) => {
    console.log(`Processing refund for order: ${orderId}`);
    console.log(`   Reason: ${reason}`);
    return `Refund request submitted for order ${orderId}. Our team will process this within 3-5 business days.`;
  },
  {
    name: "request_refund",
    description: "Process a refund request. Use when a user wants their money back.",
    schema: z.object({
      orderId: z.string().describe("The order ID to refund. It must start with 'ORD'"),
      reason: z.string().describe("A specific reason for the refund. Something that answers the question: 'Why?'"),
    }),
  }
);

const findOrder = tool(
  async ({ description }) => {
    console.log(`Finding order: ${description}`);
    return `Found order with description: ${description}. Order ID is ORD123456.`;
  },
  {
    name: "find_order",
    description: "Finds an order based on its description.",
    schema: z.object({
      description: z.string().describe("The description of the order"),
    }),
  }
);

const getProjectDetails = tool(
  async ({ question }) => {
    console.log(`Looking up: ${question}`);
    return `Project: LangsPlayground.
Tech Stack: TypeScript, LangGraph, LangChain, OpenAI
Status: Active development
Features: Tool calling, LangSmith tracing, LangGraph Studio, TrikHub integration`;
  },
  {
    name: "get_project_details",
    description: "Get project information. Use when user asks about the project.",
    schema: z.object({
      question: z.string().describe("The question about the project"),
    }),
  }
);

export const builtInTools = [requestRefund, findOrder, getProjectDetails];

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

/**
 * Load triks from .trikhub/config.json and convert to LangChain tools.
 * Uses the simplified loadLangChainTriks() API which handles:
 * - Gateway creation
 * - Config loading
 * - Session management
 */
export async function loadTriks(
  onPassthrough?: (content: PassthroughContent) => void
): Promise<TrikLoaderResult> {
  try {
    const result = await loadLangChainTriks({ onPassthrough });

    if (result.loadedTriks.length === 0) {
      console.log("[Triks] No triks configured. Use `trik install <package>` to add triks.");
    } else {
      console.log(`[Triks] Loaded ${result.loadedTriks.length} triks: ${result.loadedTriks.join(", ")}`);
    }

    return {
      tools: result.tools,
      gateway: result.gateway,
      loadedTriks: result.loadedTriks,
    };
  } catch (error) {
    console.error("[Triks] Error loading triks:", error);
    return {
      tools: [],
      gateway: null,
      loadedTriks: [],
    };
  }
}

/**
 * Load all tools: built-in + triks
 */
export async function loadAllTools(
  onPassthrough?: (content: PassthroughContent) => void
): Promise<AllToolsResult> {
  const trikResult = await loadTriks(onPassthrough);

  return {
    ...trikResult,
    allTools: [...builtInTools, ...trikResult.tools],
  };
}
