import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage, SystemMessage } from '@langchain/core/messages';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { builtInTools, loadAllTools } from './tools.js';
import { createLLM, getProviderInfo } from './llm.js';

const SYSTEM_PROMPT = `You are a helpful assistant with access to various tools.`;

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
  const result = await loadAllTools();
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
