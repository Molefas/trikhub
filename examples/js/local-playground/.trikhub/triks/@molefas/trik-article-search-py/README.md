# Article Search Trik (Python)

A demo trik that searches for and retrieves articles from a mock database. Demonstrates type-directed privilege separation with session support.

This is the Python implementation, mirroring the [JavaScript version](../article-search/).

## What it does

This trik provides three actions for interacting with a collection of articles:

- **search** - Search articles by topic using LLM-powered semantic matching. Returns matching article IDs and categorizes the query.
- **details** - Get full article content by ID or natural language reference (e.g., "the healthcare one").
- **list** - List article titles and summaries. Can use explicit IDs or pull from the last search results via session history.

The trik uses an LLM to:

1. Match search queries to relevant articles semantically
2. Resolve natural language references to specific article IDs using conversation history

## Installation

```bash
# Navigate to the root of your Agent project folder
trik install @molefas/trik-article-search-py
```

## Configuration

The trik supports multiple LLM providers. Set one of these API keys in your secrets:

| Key | Provider | Model | Priority |
|-----|----------|-------|----------|
| `ANTHROPIC_API_KEY` | Anthropic | claude-sonnet-4-20250514 | 1 (highest) |
| `OPENAI_API_KEY` | OpenAI | gpt-4o-mini | 2 |
| `GOOGLE_API_KEY` | Google | gemini-1.5-flash | 3 |

The first available key (by priority) determines which provider is used.

## Dependencies

```bash
pip install -r requirements.txt
```

Required packages:
- `anthropic>=0.40.0` - For Anthropic Claude API
- `httpx>=0.27.0` - For OpenAI and Google API HTTP requests

## Standalone Testing

```bash
# 1. Create .trikhub/secrets.json with your API key
mkdir -p .trikhub
echo '{"trik-article-search-py": {"ANTHROPIC_API_KEY": "your-key"}}' > .trikhub/secrets.json

# 2. Install dependencies
pip install -r requirements.txt

# 3. Test with the Python playground
cd /path/to/skill-poc-v2/examples/python/local-playground
python cli.py
```

## Project Structure

```
article-search-py/
├── pyproject.toml              # Python package configuration
├── requirements.txt            # Python dependencies
├── README.md                   # This file
└── trik_article_search_py/     # Package directory
    ├── __init__.py             # Package exports
    ├── graph.py                # Main trik logic (invoke function + action handlers)
    ├── llm.py                  # Multi-provider LLM abstraction (Anthropic/OpenAI/Google)
    ├── data.py                 # Mock article database
    └── manifest.json           # Trik manifest (actions, schemas, config)
```

## Response Modes

- **template** - Used by `search` action. Returns structured data that gets rendered via response templates.
- **passthrough** - Used by `details` and `list` actions. Delivers content directly to the user (not visible to the host agent).
