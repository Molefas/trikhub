# @trikhub/mcp

## 0.17.0

### Minor Changes

- [#62](https://github.com/Molefas/trikhub/pull/62) [`65a2f44`](https://github.com/Molefas/trikhub/commit/65a2f44c381fb0d82234f66b9ebcecd80dddf1ea) Thanks [@Molefas](https://github.com/Molefas)! - **BREAKING:** Require Node.js >= 22.5 (previously >= 18.0)

  - Replace `better-sqlite3` native dependency with Node.js built-in `node:sqlite`, eliminating the need for C++ build tools (python3, make, g++) during npm install
  - Add non-interactive mode (`--yes`) to `trik create-agent` for CI/scripting use
  - Fix Python trik scaffolds to include `manifest.json` inside the pip-installable package so the gateway can discover it after `pip install`
  - Add install smoke test CI workflow

### Patch Changes

- Updated dependencies [[`65a2f44`](https://github.com/Molefas/trikhub/commit/65a2f44c381fb0d82234f66b9ebcecd80dddf1ea)]:
  - @trikhub/manifest@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies []:
  - @trikhub/manifest@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies []:
  - @trikhub/manifest@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies []:
  - @trikhub/manifest@0.14.0

## 0.13.0

### Minor Changes

- [#47](https://github.com/Molefas/trikhub/pull/47) [`aa00d87`](https://github.com/Molefas/trikhub/commit/aa00d875c23e5ecd389b3da075fcc0726f6777fb) Thanks [@Molefas](https://github.com/Molefas)! - Add Python v2 parity with consolidated packages and unified release

  - Cross-language trik execution: JS gateway runs Python triks and vice versa
  - Consolidated Python package structure (single `trikhub` package on PyPI)
  - Unified versioning: all JS and Python packages share the same version
  - Fixed MCP scaffold to reference correct Python package name
  - Reverted JS CLI Python project workaround (use Python CLI for Python projects)

### Patch Changes

- Updated dependencies [[`aa00d87`](https://github.com/Molefas/trikhub/commit/aa00d875c23e5ecd389b3da075fcc0726f6777fb)]:
  - @trikhub/manifest@0.13.0

## 0.3.0

### Minor Changes

- [#45](https://github.com/Molefas/trikhub/pull/45) [`85ec622`](https://github.com/Molefas/trikhub/commit/85ec622036a10374acd5a12e70b76366fd6c34cf) Thanks [@Molefas](https://github.com/Molefas)! - update to v2: Integrated Full Agent handoff; Removed passthrough; Created a regular "Tool mode" _= breaking changes =_

### Patch Changes

- Updated dependencies [[`85ec622`](https://github.com/Molefas/trikhub/commit/85ec622036a10374acd5a12e70b76366fd6c34cf)]:
  - @trikhub/manifest@0.12.0

## 0.2.0

### Minor Changes

- [#41](https://github.com/Molefas/trikhub/pull/41) [`03f6f1d`](https://github.com/Molefas/trikhub/commit/03f6f1dfa7d54c1be6aaa8f568abec5eea800e69) Thanks [@Molefas](https://github.com/Molefas)! - E2E updates for CLI
