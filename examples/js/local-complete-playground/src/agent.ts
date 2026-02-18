import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { PassthroughContent } from "@trikhub/gateway";
import { z } from "zod";
import { builtInTools, loadAllTools } from "./tools.js";
import { createLLM, getProviderInfo } from "./llm.js";

// Validator model with structured output for reason evaluation
const reasonValidatorSchema = z.object({
  isValid: z.boolean().describe("Whether the refund reason is specific enough to process"),
  feedback: z.string().describe("If invalid, explain what information is missing"),
});

const reasonValidator = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
}).withStructuredOutput(reasonValidatorSchema);

// Track passthrough content for CLI display
let lastPassthroughContent: PassthroughContent | null = null;

export function getLastPassthroughContent(): PassthroughContent | null {
  const content = lastPassthroughContent;
  lastPassthroughContent = null;
  return content;
}

function handlePassthrough(content: PassthroughContent) {
  lastPassthroughContent = content;
}

// ============================================================================
// Graph Factory
// ============================================================================

function createAgentGraph(tools: DynamicStructuredTool[], model: BaseChatModel) {
  const boundModel = model.bindTools(tools);

  // Agent node - calls the LLM
  async function callModel(state: typeof MessagesAnnotation.State) {
    const response = await boundModel.invoke(state.messages);
    return { messages: [response] };
  }

  // Validation node - uses LLM to evaluate refund reason quality
  async function validateRefund(state: typeof MessagesAnnotation.State) {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const refundCall = lastMessage.tool_calls?.find((tc) => tc.name === "request_refund");

    if (!refundCall) return { messages: [] };

    const reason = refundCall.args.reason as string;

    // Use LLM to evaluate if the reason is sufficient
    const evaluation = await reasonValidator.invoke([
      {
        role: "system",
        content: `You evaluate refund reasons for a customer service system.
A valid reason should explain WHY the customer wants a refund.

Valid examples: "product arrived damaged", "wrong size delivered", "item doesn't match description", "received wrong color"
Invalid examples: "I want a refund", "refund please", "money back", "return", "don't want it"

Be reasonable - if there's a clear problem stated, it's valid.`,
      },
      {
        role: "user",
        content: `Evaluate this refund reason: "${reason}"`,
      },
    ]);

    console.log(`Reason validation: ${evaluation.isValid ? "Valid" : "Invalid"}`);

    if (!evaluation.isValid) {
      // Return a ToolMessage to satisfy OpenAI's requirement that every tool_call gets a response
      return {
        messages: [
          new ToolMessage({
            tool_call_id: refundCall.id!,
            content:
              `VALIDATION FAILED: ${evaluation.feedback} ` +
              `Please ask the customer for a more specific reason before trying again!`,
          }),
        ],
      };
    }

    return { messages: [] };
  }

  // Router after agent - decides next step
  function routeAfterAgent(state: typeof MessagesAnnotation.State) {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

    if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
      return END;
    }

    // Check if there's a refund request that needs validation
    const hasRefundCall = lastMessage.tool_calls.some((tc) => tc.name === "request_refund");
    if (hasRefundCall) {
      return "validate_refund";
    }

    return "tools";
  }

  // Router after validation - either proceed to tools or back to agent
  function routeAfterValidation(state: typeof MessagesAnnotation.State) {
    const lastMessage = state.messages[state.messages.length - 1];

    // If validation added a ToolMessage (rejection), go back to agent to ask for clarification
    if (lastMessage instanceof ToolMessage) {
      return "agent";
    }

    // Validation passed, proceed to execute tools
    return "tools";
  }

  // Build graph with validation branch
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("validate_refund", validateRefund)
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeAfterAgent, ["validate_refund", "tools", END])
    .addConditionalEdges("validate_refund", routeAfterValidation, ["agent", "tools"])
    .addEdge("tools", "agent");

  return workflow.compile();
}

// ============================================================================
// Exports
// ============================================================================

// Static export for LangGraph Studio (uses built-in tools only with default OpenAI)
const defaultModel = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
export const graph = createAgentGraph(builtInTools, defaultModel);

// Dynamic initialization for CLI (loads triks with flexible LLM selection)
export async function initializeAgentWithTriks() {
  const result = await loadAllTools(handlePassthrough);
  const model = await createLLM();
  const providerInfo = getProviderInfo();

  return {
    graph: createAgentGraph(result.allTools, model),
    loadedTriks: result.loadedTriks,
    gateway: result.gateway,
    tools: result.allTools,
    provider: providerInfo,
  };
}
