import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage, SystemMessage } from '@langchain/core/messages';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { PassthroughContent } from '@trikhub/gateway';
import { builtInTools, loadAllTools } from './tools.js';
import { createLLM, getProviderInfo } from './llm.js';

let lastPassthroughContent: PassthroughContent | null = null;

export function getLastPassthroughContent(): PassthroughContent | null {
  const content = lastPassthroughContent;
  lastPassthroughContent = null;
  return content;
}

function handlePassthrough(content: PassthroughContent) {
  lastPassthroughContent = content;
}

const SYSTEM_PROMPT = `You are a helpful assistant with access to various tools.

IMPORTANT: Some tools deliver content directly to the user through a separate channel (passthrough). When a tool response says "delivered directly to the user" or similar:

1. The user HAS seen the content, but YOU HAVE NOT
2. Do NOT repeat or summarize content you cannot see
3. Simply acknowledge briefly that the content was delivered

CRITICAL FOR FOLLOW-UP QUESTIONS:
- If the user asks about specifics from delivered content (titles, details, "the first one", "the third article", etc.), you CANNOT answer from memory because you never saw the content
- Instead, call the SAME trik again with the user's reference - triks have session memory and can resolve natural language references like "the first one" or "the healthcare article"
- Use the "details" action with a "reference" parameter for questions about specific items
- The trik's internal LLM will use its session history to resolve what the user is referring to
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createAgentGraph(tools: DynamicStructuredTool[], model: any) {
  const boundModel = model.bindTools(tools);

  async function callModel(state: typeof MessagesAnnotation.State) {
    const messagesWithSystem = [new SystemMessage(SYSTEM_PROMPT), ...state.messages];
    const response = await boundModel.invoke(messagesWithSystem);
    return { messages: [response] };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State) {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
      return END;
    }
    return 'tools';
  }

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', new ToolNode(tools))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, ['tools', END])
    .addEdge('tools', 'agent');

  return workflow.compile();
}

import { ChatOpenAI } from '@langchain/openai';
const defaultModel = new ChatOpenAI({ model: 'gpt-4o-mini', temperature: 0 });
export const graph = createAgentGraph(builtInTools, defaultModel);

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
