import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { TrikGateway } from '@trikhub/gateway';
import { enhance } from '@trikhub/gateway/langchain';
import { builtInTools } from './tools.js';
import { createLLM, getProviderInfo } from './llm.js';

const SYSTEM_PROMPT = `You are a helpful assistant with access to various tools.
You can check the weather, do math calculations, and search the web.
When the user asks about content curation, article writing, hoarding content, RSS feeds, or voice profiles, use the appropriate talk_to tool to hand off to a specialist agent.
Any additional tools provided by installed triks (including Python triks like text utilities) are available as native tools — use them directly.`;

export async function initializeAgent() {
  const model = await createLLM();
  const providerInfo = getProviderInfo();

  // Set up gateway and load triks from .trikhub/config.json
  const gateway = new TrikGateway();
  await gateway.initialize();
  await gateway.loadTriksFromConfig();

  // Enhance with handoff routing — createAgent rebuilds the agent when triks change
  const app = await enhance(null, {
    gatewayInstance: gateway,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangChain v0.3→v1 type mismatch (gateway typed against 0.3.x)
    createAgent: (trikTools) =>
      createReactAgent({
        llm: model,
        tools: [...builtInTools, ...trikTools] as any,
        messageModifier: SYSTEM_PROMPT,
      }),
    debug: !!process.env.TRIKHUB_DEBUG || !!process.env.TRIKHUB_VERBOSE,
    verbose: !!process.env.TRIKHUB_VERBOSE,
  });

  return {
    app,
    gateway: app.gateway,
    loadedTriks: app.getLoadedTriks(),
    provider: providerInfo,
  };
}
