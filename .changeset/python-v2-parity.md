---
"@trikhub/cli": minor
"@trikhub/gateway": minor
"@trikhub/linter": minor
"@trikhub/manifest": minor
"@trikhub/mcp": minor
"@trikhub/sdk": minor
"@trikhub/server": minor
"@trikhub/worker-js": minor
---

Add Python v2 parity with consolidated packages and unified release

- Cross-language trik execution: JS gateway runs Python triks and vice versa
- Consolidated Python package structure (single `trikhub` package on PyPI)
- Unified versioning: all JS and Python packages share the same version
- Fixed MCP scaffold to reference correct Python package name
- Reverted JS CLI Python project workaround (use Python CLI for Python projects)
