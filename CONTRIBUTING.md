# Contributing

## Setup

Requires Node.js >= 18 and pnpm >= 8.

```bash
git clone https://github.com/YOUR_USERNAME/saaas.git
cd saaas
pnpm install
pnpm build
pnpm test
```

## Project Structure

```
packages/
├── skill-manifest/   # @saaas-sdk/manifest - Types and validation
├── skill-gateway/    # @saaas-sdk/gateway - Core runtime
└── skill-linter/     # @saaas-sdk/linter - Static analysis CLI
example/              # Demo skills and agent
```

## Making Changes

1. Create a branch (`feature/thing`, `fix/thing`, etc.)
2. Make changes
3. Run `pnpm changeset` if it affects published packages
4. Open a PR

### Commits

```
feat(gateway): add session timeout config
fix(manifest): handle empty arrays in schema
docs: clarify passthrough mode
```

### Changesets

Any change to `@saaas-sdk/manifest`, `@saaas-sdk/gateway`, or `@saaas-sdk/linter` needs a changeset:

```bash
pnpm changeset
```

Pick the affected packages, describe what changed. This gets bundled into the release PR.

## Code Style

- TypeScript, ESM only
- Explicit types on public APIs
- Tests for new features

## Questions

Open an issue.
