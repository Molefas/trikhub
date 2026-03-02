# @saaas-sdk/linter

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

### Minor Changes

- [#56](https://github.com/Molefas/trikhub/pull/56) [`4d1c795`](https://github.com/Molefas/trikhub/commit/4d1c795259bc4d3ab6f72fde3700c3501e263d30) Thanks [@Molefas](https://github.com/Molefas)! - v bump

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

## 0.12.0

### Minor Changes

- [#45](https://github.com/Molefas/trikhub/pull/45) [`85ec622`](https://github.com/Molefas/trikhub/commit/85ec622036a10374acd5a12e70b76366fd6c34cf) Thanks [@Molefas](https://github.com/Molefas)! - update to v2: Integrated Full Agent handoff; Removed passthrough; Created a regular "Tool mode" _= breaking changes =_

### Patch Changes

- Updated dependencies [[`85ec622`](https://github.com/Molefas/trikhub/commit/85ec622036a10374acd5a12e70b76366fd6c34cf)]:
  - @trikhub/manifest@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies []:
  - @trikhub/manifest@0.11.0

## 0.10.0

### Minor Changes

- [`25a16ef`](https://github.com/Molefas/trikhub/commit/25a16ef1be6f158a5ad4da58497b6a1d52be6c74) - Added unpublish feature; Added lint to CLI; Added init feature.

### Patch Changes

- Updated dependencies [[`25a16ef`](https://github.com/Molefas/trikhub/commit/25a16ef1be6f158a5ad4da58497b6a1d52be6c74)]:
  - @trikhub/manifest@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies []:
  - @trikhub/manifest@0.9.0

## 0.7.0

### Patch Changes

- Updated dependencies []:
  - @trikhub/manifest@0.7.0

## 0.6.1

### Patch Changes

- Updated dependencies []:
  - @trikhub/manifest@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [[`8d62eba`](https://github.com/Molefas/trikhub/commit/8d62eba7d60677adf747c1d062fb5572f7aee749)]:
  - @trikhub/manifest@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies []:
  - @trikhub/manifest@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @trikhub/manifest@0.4.0

## 0.3.0

### Minor Changes

- [`650b022`](https://github.com/Muffles/trikhub/commit/650b022e7428de19ee28676b11ec916b606b9385) - Simplified publishing; Fixes

### Patch Changes

- Updated dependencies [[`650b022`](https://github.com/Muffles/trikhub/commit/650b022e7428de19ee28676b11ec916b606b9385)]:
  - @trikhub/manifest@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @trikhub/manifest@0.2.0

## 0.2.0

### Minor Changes

- [#3](https://github.com/Muffles/saaas-sdk/pull/3) [`4f5ec53`](https://github.com/Muffles/saaas-sdk/commit/4f5ec53caea1175bb23a0bccdf7f6f2afe4f45f6) Thanks [@Muffles](https://github.com/Muffles)! - Release

- [#2](https://github.com/Muffles/saaas-sdk/pull/2) [`32d787b`](https://github.com/Muffles/saaas-sdk/commit/32d787b725b39d9d7be0598d826d1de71920f0fe) Thanks [@Muffles](https://github.com/Muffles)! - initial release

### Patch Changes

- Updated dependencies [[`4f5ec53`](https://github.com/Muffles/saaas-sdk/commit/4f5ec53caea1175bb23a0bccdf7f6f2afe4f45f6), [`32d787b`](https://github.com/Muffles/saaas-sdk/commit/32d787b725b39d9d7be0598d826d1de71920f0fe)]:
  - @saaas-sdk/manifest@0.2.0
