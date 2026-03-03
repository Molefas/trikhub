---
"@trikhub/gateway": minor
"@trikhub/cli": minor
"@trikhub/manifest": minor
"@trikhub/sdk": minor
"@trikhub/mcp": minor
"@trikhub/server": minor
"@trikhub/linter": minor
"@trikhub/worker-js": minor
---

**BREAKING:** Require Node.js >= 22.5 (previously >= 18.0)

- Replace `better-sqlite3` native dependency with Node.js built-in `node:sqlite`, eliminating the need for C++ build tools (python3, make, g++) during npm install
- Add non-interactive mode (`--yes`) to `trik create-agent` for CI/scripting use
- Fix Python trik scaffolds to include `manifest.json` inside the pip-installable package so the gateway can discover it after `pip install`
- Add install smoke test CI workflow
