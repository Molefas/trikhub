# TrikHub Node.js Worker Image
#
# Generic worker image for running containerized JavaScript/TypeScript triks.
# The trik source is mounted at runtime, not baked into the image.
#
# Build:
#   docker build -f docker/worker-node.Dockerfile -t trikhub/worker-node:22 .
#
# Run:
#   docker run -i --rm \
#     -v ~/.trikhub/workspace/<trik-id>:/workspace \
#     -v /path/to/trik:/trik:ro \
#     trikhub/worker-node:22

FROM node:22-slim

# Install pnpm for trik dependency installation
RUN corepack enable && corepack prepare pnpm@latest --activate

# Create workspace and trik mount points
RUN mkdir -p /workspace /trik

# Install the TrikHub worker and SDK packages
# We copy only what's needed for the worker to run
WORKDIR /trikhub

# Copy package manifests for dependency resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/js/manifest/package.json packages/js/manifest/
COPY packages/js/sdk/package.json packages/js/sdk/
COPY packages/js/worker/package.json packages/js/worker/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod --filter @trikhub/worker-js --filter @trikhub/sdk --filter @trikhub/manifest 2>/dev/null || \
    pnpm install --prod --filter @trikhub/worker-js --filter @trikhub/sdk --filter @trikhub/manifest

# Copy built distribution files
COPY packages/js/manifest/dist packages/js/manifest/dist/
COPY packages/js/sdk/dist packages/js/sdk/dist/
COPY packages/js/worker/dist packages/js/worker/dist/

# Set working directory to workspace for trik execution
WORKDIR /workspace

# Worker communicates via stdin/stdout (JSON-RPC 2.0)
ENTRYPOINT ["node", "/trikhub/packages/js/worker/dist/worker.js"]
