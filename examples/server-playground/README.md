# TrikHub Server Playground

A POC demonstrating how to use **trik-server** with a **Python LangGraph agent**.

This is the Python equivalent of [trikhub-playground](../trikhub-playground), but instead of using the `@trikhub/gateway` SDK directly, it communicates with triks via HTTP API through `trik-server`.

## Architecture

```
┌─────────────────────┐     HTTP      ┌─────────────────────┐
│   Python Agent      │ ────────────► │    trik-server      │
│   (LangGraph)       │               │    (Node.js)        │
└─────────────────────┘               └──────────┬──────────┘
                                                 │
                                                 ▼
                                      ┌─────────────────────┐
                                      │   article-search    │
                                      │      (Trik)         │
                                      └─────────────────────┘
```

## Features

- **Built-in Tools**: `request_refund`, `find_order`, `get_project_details`
- **Trik Tools**: Loaded dynamically from trik-server (article-search: search, details, list)
- **Validation Workflow**: LLM validates refund reasons before processing
- **Passthrough Content**: Article content delivered directly to user (bypasses agent)

## Prerequisites

- Python 3.11+
- Node.js 22+ and pnpm
- OpenAI API key

## Quick Start

### 1. Build trik-server (first time only)

```bash
pnpm install
pnpm build
```

### 2. Start trik-server

In one terminal:

```bash
cd server
./start.sh
```

Verify it's running:

```bash
curl http://localhost:3002/api/v1/health
curl http://localhost:3002/api/v1/tools
```

### 3. Set up Python environment

In another terminal:

```bash
cd agent

# Create virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
echo "OPENAI_API_KEY=your-key-here" > .env
```

### 4. Run the agent

```bash
python cli.py
```

## Usage Examples

### Article Search (Trik)

```
You: search for articles about AI
Assistant: I found 3 articles about AI.

You: show me the list
--- Direct Content (article-list) ---
1. **The Future of AI in Healthcare**
   AI is transforming medical diagnosis and treatment planning.
...
--- End ---