# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace files
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./

# Copy all packages
COPY packages/ ./packages/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build all packages
RUN pnpm build

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy built packages
COPY --from=builder /app/packages/skill-manifest/dist ./packages/skill-manifest/dist
COPY --from=builder /app/packages/skill-manifest/package.json ./packages/skill-manifest/
COPY --from=builder /app/packages/skill-gateway/dist ./packages/skill-gateway/dist
COPY --from=builder /app/packages/skill-gateway/package.json ./packages/skill-gateway/
COPY --from=builder /app/packages/skill-linter/dist ./packages/skill-linter/dist
COPY --from=builder /app/packages/skill-linter/package.json ./packages/skill-linter/
COPY --from=builder /app/packages/skill-server/dist ./packages/skill-server/dist
COPY --from=builder /app/packages/skill-server/package.json ./packages/skill-server/

# Copy root package files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Create skills directory
RUN mkdir -p /data/skills

# Environment
ENV NODE_ENV=production
ENV SKILLS_DIR=/data/skills
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

# Run server
CMD ["node", "packages/skill-server/dist/index.js"]
