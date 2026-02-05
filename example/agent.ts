import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatAnthropic } from '@langchain/anthropic';
import { StateGraph, Annotation, END } from '@langchain/langgraph';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { SkillGateway } from '@saaas/gateway';
import { createLangChainTools } from '@saaas/gateway/langchain';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env') });

const AgentState = Annotation.Root({
  userMessage: Annotation<string>,
  messages: Annotation<(HumanMessage | AIMessage | SystemMessage | ToolMessage)[]>({
    reducer: (curr, update) => [...curr, ...update],
    default: () => [],
  }),
  nextAction: Annotation<'call_skill' | 'respond' | null>,
  response: Annotation<string | null>,
});

export interface AgentConfig {
  skillPath?: string;
  debug?: boolean;
}

export class LangGraphAgent {
  private gateway: SkillGateway;
  private graph: ReturnType<typeof this.buildGraph> | null = null;
  private tools: DynamicStructuredTool[] = [];
  private debug: boolean;
  private skillPath: string;
  private activeSessions = new Map<string, string>();
  private conversationHistory: (HumanMessage | AIMessage | SystemMessage | ToolMessage)[] = [];

  constructor(config: AgentConfig = {}) {
    this.gateway = new SkillGateway();
    this.debug = config.debug ?? false;
    this.skillPath = config.skillPath ?? resolve(__dirname, 'skills/demo/article-search');
  }

  async initialize(): Promise<void> {
    if (this.debug) {
      console.log(`[Agent] Loading skill from ${this.skillPath}...`);
    }

    const manifest = await this.gateway.loadSkill(this.skillPath);

    if (this.debug) {
      console.log(`[Agent] Loaded skill: ${manifest.id}`);
      console.log(`[Agent] Available actions: ${Object.keys(manifest.actions).join(', ')}`);
    }

    this.tools = createLangChainTools(this.gateway, {
      getSessionId: (skillId) => this.activeSessions.get(skillId),
      setSessionId: (skillId, sessionId) => this.activeSessions.set(skillId, sessionId),
      debug: this.debug,
    });

    if (this.debug) {
      console.log(`[Agent] Generated ${this.tools.length} tools: ${this.tools.map((t) => t.name).join(', ')}`);
    }

    this.graph = this.buildGraph();

    if (this.debug) {
      console.log('[Agent] LangGraph initialized with nodes: decisionNode, executeSkill');
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

      const systemPrompt = `You are an AI assistant with access to skills via tools.

AVAILABLE TOOLS:
${toolDescriptions}

When you call a skill, you'll receive a response field with ready-to-use text.
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
          nextAction: 'call_skill' as const,
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

    async function executeSkillNode(state: typeof AgentState.State) {
      if (self.debug) {
        console.log('\n--- EXECUTE SKILL NODE ---');
      }

      const lastMessage = state.messages[state.messages.length - 1];
      if (!(lastMessage instanceof AIMessage) || !lastMessage.tool_calls?.length) {
        return { nextAction: 'respond' as const };
      }

      const toolCall = lastMessage.tool_calls[0];

      if (self.debug) {
        console.log(`[ExecuteSkill] Calling tool: ${toolCall.name}`);
        console.log(`[ExecuteSkill] Arguments: ${JSON.stringify(toolCall.args)}`);
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
        console.log(`[ExecuteSkill] Result: ${JSON.stringify(parsed)}`);
      }

      if (parsed._directOutput) {
        if (self.debug) {
          console.log('[ExecuteSkill] Direct output detected - bypassing LLM');
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
        nextAction: null as 'call_skill' | 'respond' | null,
      };
    }

    function shouldContinue(state: typeof AgentState.State): 'executeSkill' | 'decisionNode' | '__end__' {
      if (state.response) {
        return '__end__';
      }

      if (state.nextAction === 'call_skill') {
        return 'executeSkill';
      }

      if (state.nextAction === null) {
        return 'decisionNode';
      }

      return '__end__';
    }

    const workflow = new StateGraph(AgentState)
      .addNode('decisionNode', decisionNode)
      .addNode('executeSkill', executeSkillNode)
      .addEdge('__start__', 'decisionNode')
      .addConditionalEdges('decisionNode', shouldContinue, {
        executeSkill: 'executeSkill',
        decisionNode: 'decisionNode',
        __end__: END,
      })
      .addConditionalEdges('executeSkill', shouldContinue, {
        decisionNode: 'decisionNode',
        executeSkill: 'executeSkill',
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
