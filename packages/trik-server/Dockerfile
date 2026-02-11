# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate


COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./
COPY tsconfig.docker.json ./

COPY packages/trik-manifest/ ./packages/trik-manifest/
COPY packages/trik-gateway/ ./packages/trik-gateway/
COPY packages/trik-linter/ ./packages/trik-linter/
COPY packages/trik-server/ ./packages/trik-server/
COPY packages/trik-cli/ ./packages/trik-cli/

RUN pnpm install --filter @trikhub/server... --filter @trikhub/cli...

RUN mkdir -p node_modules/@trikhub && \
    ln -s ../../packages/trik-manifest node_modules/@trikhub/manifest && \
    ln -s ../../packages/trik-gateway node_modules/@trikhub/gateway && \
    ln -s ../../packages/trik-linter node_modules/@trikhub/linter && \
    ln -s ../../packages/trik-server node_modules/@trikhub/server && \
    ln -s ../../packages/trik-cli node_modules/@trikhub/cli

RUN cd packages/trik-manifest && pnpm run build && ls -la dist/

RUN pnpm exec tsc -b packages/trik-gateway packages/trik-linter packages/trik-server packages/trik-cli --force

RUN ls -la packages/*/dist/

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

# Install pnpm for potential runtime npm skill installation
RUN corepack enable && corepack prepare pnpm@latest --activate

RUN addgroup -g 1001 trikhub && \
    adduser -S -u 1001 -G trikhub trikhub

COPY --from=builder /app/packages/trik-manifest/dist ./packages/trik-manifest/dist
COPY --from=builder /app/packages/trik-manifest/package.json ./packages/trik-manifest/

COPY --from=builder /app/packages/trik-gateway/dist ./packages/trik-gateway/dist
COPY --from=builder /app/packages/trik-gateway/package.json ./packages/trik-gateway/

COPY --from=builder /app/packages/trik-linter/dist ./packages/trik-linter/dist
COPY --from=builder /app/packages/trik-linter/package.json ./packages/trik-linter/

COPY --from=builder /app/packages/trik-server/dist ./packages/trik-server/dist
COPY --from=builder /app/packages/trik-server/package.json ./packages/trik-server/

COPY --from=builder /app/packages/trik-cli/dist ./packages/trik-cli/dist
COPY --from=builder /app/packages/trik-cli/package.json ./packages/trik-cli/

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./

RUN pnpm install --prod --frozen-lockfile

RUN ln -s /app/packages/trik-cli/dist/cli.js /usr/local/bin/trik && \
    chmod +x /app/packages/trik-cli/dist/cli.js

RUN mkdir -p /data/skills /data/.trikhub && \
    echo '{"triks":[]}' > /data/.trikhub/config.json && \
    chown -R trikhub:trikhub /data /app

ENV NODE_ENV=production
ENV SKILLS_DIR=/data/skills
ENV CONFIG_PATH=/data/.trikhub/config.json
ENV PORT=3000
ENV HOST=0.0.0.0
ENV LOG_LEVEL=info
ENV LINT_ON_LOAD=true

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

USER trikhub

CMD ["node", "packages/trik-server/dist/cli.js"]
