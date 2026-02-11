# LangGraph Playground

A minimal TypeScript playground for learning LangGraph, LangChain, and LangSmith.

## Project Structure

```
LangsPlayground/
├── src/
│   └── agent.ts         # Main agent graph (POC)
├── .env.example         # Environment variables template
├── .gitignore
├── context.md           # This file
├── langgraph.json       # LangGraph Studio configuration
├── package.json
└── tsconfig.json
```

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and add your API keys:
   - `OPENAI_API_KEY` - Get from https://platform.openai.com/api-keys
   - `LANGSMITH_API_KEY` - Get from https://smith.langchain.com/settings

3. **Run the POC:**
   ```bash
   npm run dev
   ```

4. **Launch LangGraph Studio (visual debugger):**
   ```bash
   npm run studio
   ```

## Key Concepts

### LangGraph
- **StateGraph**: The main building block. Defines nodes and edges.
- **Nodes**: Functions that process state (e.g., call an LLM, run tools)
- **Edges**: Define the flow between nodes
- **State**: Data that flows through the graph (using Annotations)

### MessagesAnnotation
Built-in annotation for chat-style applications. Automatically handles message history with a `messages` array.

### LangSmith
When `LANGSMITH_TRACING=true`, all graph executions are automatically traced. View traces at https://smith.langchain.com to debug and understand your agent's behavior.

## Documentation Links

- [LangGraph.js Docs](https://langchain-ai.github.io/langgraphjs/)
- [LangChain.js Docs](https://js.langchain.com/docs/)
- [LangSmith Docs](https://docs.smith.langchain.com/)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)

## Next Steps

Ideas for expanding this playground:
1. Add tools (web search, calculator, etc.)
2. Implement conditional edges (routing)
3. Add memory/checkpointing for multi-turn conversations
4. Build a ReAct agent with tool calling
5. Create custom state with additional fields
