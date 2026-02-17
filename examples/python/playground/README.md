# TrikHub Python Playground

Demonstrates the **Python Gateway** executing both Python and JavaScript triks.

## What You'll Learn

- How to use `TrikGateway` from Python
- How Python triks execute **natively** (in-process)
- How JavaScript triks execute via **Node.js worker** subprocess
- Cross-language trik execution without HTTP servers

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Python Gateway                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    TrikGateway (Python)                            │  │
│  │                                                                     │  │
│  │  ├── @demo/hello-py  →  in-process (native Python execution)      │  │
│  │  │                       Fast, no subprocess overhead              │  │
│  │  │                                                                  │  │
│  │  └── @demo/hello-js  →  Node.js worker subprocess                 │  │
│  │                          JSON-RPC over stdin/stdout                │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Python 3.10+
- Node.js 18+ (for JavaScript triks)

## Quick Start

```bash
cd examples/python/playground

# Install trikhub (from repo root)
cd ../../../packages/python
pip install -e .
cd ../../examples/python/playground

# Run the example
python agent.py
```

## Expected Output

```
============================================================
TrikHub Python Gateway - Cross-Language Trik Execution
============================================================

[Gateway] Initializing...
[Gateway] Loading triks from: .../triks
[Gateway] Loaded 2 triks:
  - @demo/hello-py (runtime: python)
  - @demo/hello-js (runtime: node)

[Gateway] Available tools (4):
  - @demo/hello-py:greet: Generate a greeting message from Python
  - @demo/hello-py:reverse: Reverse a string
  - @demo/hello-js:greet: Generate a greeting message
  - @demo/hello-js:calculate: Perform a simple calculation

------------------------------------------------------------
Demo: Executing Triks
------------------------------------------------------------

[Demo 1] Python Trik - Native Execution
----------------------------------------
  Action: @demo/hello-py:greet
  Input:  {'name': 'World'}
  Result: {'template': 'success', 'message': 'Hello, World!...', 'language': 'Python 3.10'}
  Text:   Python says: Hello, World!... (powered by Python 3.10)

[Demo 2] JavaScript Trik - Node.js Worker Execution
----------------------------------------
  Action: @demo/hello-js:greet
  Input:  {'name': 'Python'}
  Result: {'template': 'success', 'message': 'Hello, Python!...', 'timestamp': '...'}
  Text:   Generated greeting: Hello, Python!... (at ...)

[Demo 3] Mixed Execution - Both Runtimes
----------------------------------------
  Python (reverse 'hello'):  olleh
  JavaScript (10 + 20):      30

============================================================
SUCCESS! Both Python and JavaScript triks executed correctly.
============================================================

[Gateway] Shutting down...
[Gateway] Done.
```

## Project Structure

```
playground/
├── README.md           # This file
├── agent.py            # Main example script
└── triks/
    └── @demo/
        ├── hello-py/   # Python trik (native execution)
        │   ├── manifest.json
        │   └── graph.py
        └── hello-js/   # JavaScript trik (Node.js worker)
            ├── manifest.json
            └── graph.js
```

## How It Works

### Python Triks (Native)

```python
# Python triks are loaded and executed in-process
result = await gateway.execute(
    trik_id="@demo/hello-py",
    action="greet",
    input={"name": "World"},
)
```

The gateway:
1. Loads the Python module dynamically
2. Calls the `invoke()` method directly
3. Returns the result immediately

### JavaScript Triks (Node.js Worker)

```python
# JavaScript triks are executed via subprocess
result = await gateway.execute(
    trik_id="@demo/hello-js",
    action="greet",
    input={"name": "Python"},
)
```

The gateway:
1. Spawns a Node.js worker process (if not already running)
2. Sends a JSON-RPC request over stdin
3. Receives the response over stdout
4. Returns the result

The Node.js worker stays running for subsequent requests (singleton pattern).

## Creating Your Own Triks

### Python Trik

```python
# my-trik/graph.py
class MyGraph:
    async def invoke(self, input_data: dict) -> dict:
        action = input_data.get("action")
        action_input = input_data.get("input", {})

        # Handle actions...
        return {
            "responseMode": "template",
            "agentData": {"template": "success", "data": "..."},
        }

graph = MyGraph()
```

### JavaScript Trik

```javascript
// my-trik/graph.js
class MyGraph {
    async invoke(input) {
        const { action, input: actionInput } = input;

        // Handle actions...
        return {
            responseMode: "template",
            agentData: { template: "success", data: "..." },
        };
    }
}

const graph = new MyGraph();
module.exports = { graph };
```

### Manifest (Both Languages)

```json
{
  "id": "@scope/my-trik",
  "name": "My Trik",
  "version": "1.0.0",
  "entry": {
    "module": "./graph.py",  // or "./graph.js"
    "export": "graph",
    "runtime": "python"      // or "node"
  },
  "actions": { ... },
  "capabilities": { ... },
  "limits": { ... }
}
```

## Next Steps

- [Build your own trik](../../../README.md#building-a-trik)
- [Python Gateway API](../../../packages/python/README.md)
- [TypeScript Gateway](../../js/local-playground) - Same concepts, TypeScript ecosystem
