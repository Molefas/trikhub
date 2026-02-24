import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { TrikGateway } from '@trikhub/gateway';
import { enhance, getHandoffToolsForAgent } from '@trikhub/gateway/langchain';
import { builtInTools } from './tools.js';
import { createLLM, getProviderInfo } from './llm.js';

const SYSTEM_PROMPT = `You are a helpful assistant with access to various tools.
You can check the weather, do math calculations, and search the web.
When the user asks about content curation, article writing, hoarding content, RSS feeds, or voice profiles, use the appropriate talk_to tool to hand off to a specialist agent.`;

export async function initializeAgent() {
  const model = await createLLM();
  const providerInfo = getProviderInfo();

  // Set up gateway and load triks from .trikhub/config.json
  const gateway = new TrikGateway();
  await gateway.initialize();
  await gateway.loadTriksFromConfig();

  // Build handoff tools for loaded triks
  const handoffTools = getHandoffToolsForAgent(gateway);

  // Create main agent with built-in + handoff tools
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangChain v0.3→v1 type mismatch (gateway typed against 0.3.x)
  const allTools = [...builtInTools, ...handoffTools] as any;
  const agent = createReactAgent({
    llm: model,
    tools: allTools,
    messageModifier: SYSTEM_PROMPT,
  });

  // Enhance with handoff routing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same v0.3→v1 type mismatch
  const app = await enhance(agent as any, {
    gatewayInstance: gateway,
    debug: !!process.env.TRIKHUB_DEBUG || !!process.env.TRIKHUB_VERBOSE,
    verbose: !!process.env.TRIKHUB_VERBOSE,
  });

  return {
    app,
    loadedTriks: app.getLoadedTriks(),
    provider: providerInfo,
  };
}
