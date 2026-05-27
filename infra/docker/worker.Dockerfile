FROM node:26-bookworm-slim AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Needed for tree-sitter + @dodona/dolos-parsers native addon build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.33.0

WORKDIR /build

# 1. Copy dependency manifests for cache-friendly install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY tooling/typescript/base.json tooling/typescript/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/temporal/package.json packages/temporal/
COPY packages/domain/package.json packages/domain/
COPY packages/redis/package.json packages/redis/
COPY packages/job-dispatch/package.json packages/job-dispatch/

RUN pnpm install --frozen-lockfile --filter @nojv/worker...

# 2. Copy source and build in dependency order
COPY packages/core/ packages/core/
COPY packages/db/ packages/db/
COPY packages/redis/ packages/redis/
COPY packages/job-dispatch/ packages/job-dispatch/
COPY packages/domain/ packages/domain/
COPY packages/temporal/ packages/temporal/
COPY apps/worker/ apps/worker/

RUN pnpm --filter @nojv/db build
RUN pnpm --filter @nojv/core build
RUN pnpm --filter @nojv/redis build
RUN pnpm --filter @nojv/job-dispatch build
RUN pnpm --filter @nojv/domain build
RUN pnpm --filter @nojv/temporal build
RUN pnpm --filter @nojv/worker build

# 3. Production image
FROM node:26-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --create-home appuser

WORKDIR /app

# Root node_modules contains pnpm virtual store; app-level node_modules symlinks
# resolve into this directory.
COPY --from=builder --chown=appuser:nodejs /build/node_modules/ ./node_modules/

# Workspace package dist + package.json — the symlinks above resolve to these.
COPY --from=builder --chown=appuser:nodejs /build/packages/core/dist/ ./packages/core/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/core/package.json ./packages/core/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/core/node_modules/ ./packages/core/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/db/dist/ ./packages/db/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/db/package.json ./packages/db/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/db/node_modules/ ./packages/db/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/temporal/dist/ ./packages/temporal/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/temporal/package.json ./packages/temporal/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/temporal/node_modules/ ./packages/temporal/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/domain/dist/ ./packages/domain/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/domain/package.json ./packages/domain/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/domain/node_modules/ ./packages/domain/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/dist/ ./packages/redis/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/package.json ./packages/redis/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/node_modules/ ./packages/redis/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/job-dispatch/dist/ ./packages/job-dispatch/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/job-dispatch/package.json ./packages/job-dispatch/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/job-dispatch/node_modules/ ./packages/job-dispatch/node_modules/

# Prisma generated client output (prisma-client generator)
COPY --from=builder --chown=appuser:nodejs /build/packages/db/generated/prisma/ ./packages/db/generated/prisma/

# Keep app directory depth so pnpm relative symlinks remain valid in runtime.
COPY --from=builder --chown=appuser:nodejs /build/apps/worker/dist/ ./apps/worker/dist/
COPY --from=builder --chown=appuser:nodejs /build/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder --chown=appuser:nodejs /build/apps/worker/node_modules/ ./apps/worker/node_modules/

WORKDIR /app/apps/worker

ENV NODE_ENV=production
EXPOSE 8080

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/healthz').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
