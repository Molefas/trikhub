import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatAnthropic } from '@langchain/anthropic';
import { StateGraph, Annotation, END } from '@langchain/langgraph';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { TrikGateway } from '@trikhub/gateway';
import { createLangChainTools } from '@trikhub/gateway/langchain';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env') });

const AgentState = Annotation.Root({
  userMessage: Annotation<string>,
  messages: Annotation<(HumanMessage | AIMessage | SystemMessage | ToolMessage)[]>({
    reducer: (curr, update) => [...curr, ...update],
    default: () => [],
  }),
  nextAction: Annotation<'call_trik' | 'respond' | null>,
  response: Annotation<string | null>,
});

export interface AgentConfig {
  trikPath?: string;
  debug?: boolean;
}

export class LangGraphAgent {
  private gateway: TrikGateway;
  private graph: ReturnType<typeof this.buildGraph> | null = null;
  private tools: DynamicStructuredTool[] = [];
  private debug: boolean;
  private trikPath: string;
  private activeSessions = new Map<string, string>();
  private conversationHistory: (HumanMessage | AIMessage | SystemMessage | ToolMessage)[] = [];

  constructor(config: AgentConfig = {}) {
    this.gateway = new TrikGateway();
    this.debug = config.debug ?? false;
    this.trikPath = config.trikPath ?? resolve(__dirname, 'triks/demo/article-search');
  }

  async initialize(): Promise<void> {
    if (this.debug) {
      console.log(`[Agent] Loading trik from ${this.trikPath}...`);
    }

    const manifest = await this.gateway.loadTrik(this.trikPath);

    if (this.debug) {
      console.log(`[Agent] Loaded trik: ${manifest.id}`);
      console.log(`[Agent] Available actions: ${Object.keys(manifest.actions).join(', ')}`);
    }

    this.tools = createLangChainTools(this.gateway, {
      getSessionId: (trikId) => this.activeSessions.get(trikId),
      setSessionId: (trikId, sessionId) => this.activeSessions.set(trikId, sessionId),
      debug: this.debug,
    });

    if (this.debug) {
      console.log(`[Agent] Generated ${this.tools.length} tools: ${this.tools.map((t) => t.name).join(', ')}`);
    }

    this.graph = this.buildGraph();

    if (this.debug) {
      console.log('[Agent] LangGraph initialized with nodes: decisionNode, executeTrik');
    }
  }

  private buildGraph() {
    const self = this;

    const decisionModel = new ChatAnthropic({
      model: 'claude-sonnet-4-20250514',
      temperature: 0,
    }).bindTools(this.tools);

    const toolDescriptions = this.tools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');

    async function decisionNode(state: typeof AgentState.State) {
      if (self.debug) {
        console.log('\n--- DECISION NODE ---');
        console.log('[Decision] Processing user message...');
      }

      const systemPrompt = `You are an AI assistant with access to triks via tools.

AVAILABLE TOOLS:
${toolDescriptions}

When you call a trik, you'll receive a response field with ready-to-use text.
Present this response to the user. That's it - no special handling needed.`;

      const messages = [
        new SystemMessage(systemPrompt),
        ...state.messages,
      ];

      const response = await decisionModel.invoke(messages);

      if (self.debug) {
        console.log(`[Decision] Model response type: ${response.tool_calls?.length ? 'tool_call' : 'text'}`);
      }

      if (response.tool_calls && response.tool_calls.length > 0) {
        return {
          messages: [response],
          nextAction: 'call_trik' as const,
        };
      }

      const content = typeof response.content === 'string' ? response.content : '';

      if (self.debug) {
        console.log('[Decision] Model responding directly');
      }

      return {
        messages: [response],
        nextAction: 'respond' as const,
        response: content,
      };
    }

    async function executeTrikNode(state: typeof AgentState.State) {
      if (self.debug) {
        console.log('\n--- EXECUTE TRIK NODE ---');
      }

      const lastMessage = state.messages[state.messages.length - 1];
      if (!(lastMessage instanceof AIMessage) || !lastMessage.tool_calls?.length) {
        return { nextAction: 'respond' as const };
      }

      const toolCall = lastMessage.tool_calls[0];

      if (self.debug) {
        console.log(`[ExecuteTrik] Calling tool: ${toolCall.name}`);
        console.log(`[ExecuteTrik] Arguments: ${JSON.stringify(toolCall.args)}`);
      }

      const matchingTool = self.tools.find((t) => t.name === toolCall.name);
      let result: string;

      if (matchingTool) {
        result = await matchingTool.invoke(toolCall.args as Record<string, unknown>);
      } else {
        result = JSON.stringify({ success: false, error: `Unknown tool: ${toolCall.name}` });
      }

      const parsed = JSON.parse(result);

      if (self.debug) {
        console.log(`[ExecuteTrik] Result: ${JSON.stringify(parsed)}`);
      }

      if (parsed._directOutput) {
        if (self.debug) {
          console.log('[ExecuteTrik] Direct output detected - bypassing LLM');
        }

        const toolMessageContent = { ...parsed };
        delete toolMessageContent._directOutput;

        const toolMessage = new ToolMessage({
          tool_call_id: toolCall.id!,
          content: JSON.stringify(toolMessageContent),
        });

        return {
          messages: [toolMessage],
          response: parsed._directOutput,
          nextAction: 'respond' as const,
        };
      }

      const toolMessage = new ToolMessage({
        tool_call_id: toolCall.id!,
        content: JSON.stringify(parsed),
      });

      return {
        messages: [toolMessage],
        nextAction: null as 'call_trik' | 'respond' | null,
      };
    }

    function shouldContinue(state: typeof AgentState.State): 'executeTrik' | 'decisionNode' | '__end__' {
      if (state.response) {
        return '__end__';
      }

      if (state.nextAction === 'call_trik') {
        return 'executeTrik';
      }

      if (state.nextAction === null) {
        return 'decisionNode';
      }

      return '__end__';
    }

    const workflow = new StateGraph(AgentState)
      .addNode('decisionNode', decisionNode)
      .addNode('executeTrik', executeTrikNode)
      .addEdge('__start__', 'decisionNode')
      .addConditionalEdges('decisionNode', shouldContinue, {
        executeTrik: 'executeTrik',
        decisionNode: 'decisionNode',
        __end__: END,
      })
      .addConditionalEdges('executeTrik', shouldContinue, {
        decisionNode: 'decisionNode',
        executeTrik: 'executeTrik',
        __end__: END,
      });

    return workflow.compile();
  }

  async chat(userMessage: string): Promise<string> {
    if (!this.graph) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }

    if (this.debug) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`[Agent] User message: "${userMessage}"`);
      console.log(`[Agent] Conversation history: ${this.conversationHistory.length} messages`);
      console.log('='.repeat(60));
    }

    const newUserMessage = new HumanMessage(userMessage);

    const initialState = {
      userMessage,
      messages: [...this.conversationHistory, newUserMessage],
      nextAction: null,
      response: null,
    };

    const result = await this.graph.invoke(initialState);

    this.conversationHistory.push(newUserMessage);
    if (result.response) {
      this.conversationHistory.push(new AIMessage(result.response));
    }

    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }

    return result.response || "I couldn't process your request.";
  }
}
