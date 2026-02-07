# Contributing

## Setup

Requires Node.js >= 18 and pnpm >= 8.

```bash
git clone https://github.com/YOUR_USERNAME/trikhub.git
cd trikhub
pnpm install
pnpm build
pnpm test
```

## Project Structure

```
packages/
├── trik-manifest/   # @trikhub/manifest - Types and validation
├── trik-gateway/    # @trikhub/gateway - Core runtime
└── trik-linter/     # @trikhub/linter - Static analysis CLI
example/              # Demo triks and agent
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

Any change to `@trikhub/manifest`, `@trikhub/gateway`, or `@trikhub/linter` needs a changeset:

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
