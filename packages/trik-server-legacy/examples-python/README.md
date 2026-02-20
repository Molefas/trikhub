# Python Agent Integration

Example Python code for integrating your LangGraph agent with the Skill Gateway.

## Files

| File | Description |
|------|-------------|
| `gateway_client.py` | HTTP client for the Skill Gateway API |
| `langgraph_tools.py` | Adapter to convert gateway tools to LangChain format |
| `example_agent.py` | Full LangGraph agent example |
| `requirements.txt` | Python dependencies |

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export ANTHROPIC_API_KEY=your-key
export GATEWAY_URL=http://localhost:3000

# Run the example agent
python example_agent.py
```

## Integration Steps

### 1. Basic Client Usage

```python
from gateway_client import GatewayClient

client = GatewayClient("http://localhost:3000")

# Get available tools
tools = client.get_tools()

# Execute a tool
result = client.execute("my-skill:my-action", {"query": "hello"})

# Handle passthrough content
if result.response_mode == "passthrough":
    content = client.get_content(result.user_content_ref)
    # Deliver content directly to user (agent never sees it)
```

### 2. LangGraph Integration

```python
from gateway_client import GatewayClient
from langgraph_tools import SkillToolAdapter

client = GatewayClient("http://localhost:3000")

def on_passthrough(content, metadata):
    # Deliver to user directly
    print(content)

adapter = SkillToolAdapter(client, on_passthrough=on_passthrough)
tools = adapter.create_tools()

# Use tools with your LangGraph agent
llm = ChatAnthropic(model="claude-sonnet-4-20250514").bind_tools(tools)
```

### 3. With Authentication

```python
client = GatewayClient(
    "http://localhost:3000",
    auth_token="your-secret-token"
)
```

## Security Model

The integration preserves the prompt injection protection:

1. **Template mode**: Agent receives structured data (enums, numbers) - safe to reason over
2. **Passthrough mode**: Content goes directly to user via `on_passthrough` callback - agent never sees it

This means malicious content in skill responses (like "IGNORE INSTRUCTIONS...") never reaches your agent's decision-making layer.

## Customization

### Custom Tool Names

LangChain doesn't allow colons in tool names, so `article-search:search` becomes `article-search__search`. You can customize this in `langgraph_tools.py`.

### Session Handling

The adapter automatically tracks session IDs for multi-turn conversations. Sessions are skill-specific.

### Error Handling

```python
result = client.execute("skill:action", input_data)
if not result.success:
    print(f"Error {result.code}: {result.error}")
```
