FROM node:26-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /build

# 1. Copy dependency manifests for cache-friendly install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY tooling/typescript/base.json tooling/typescript/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/redis/package.json packages/redis/
COPY packages/storage/package.json packages/storage/
COPY packages/job-dispatch/package.json packages/job-dispatch/

RUN pnpm install --frozen-lockfile --filter @nojv/web...

# 2. Copy source and build in dependency order
COPY packages/core/ packages/core/
COPY packages/db/ packages/db/
COPY packages/redis/ packages/redis/
COPY packages/storage/ packages/storage/
COPY packages/job-dispatch/ packages/job-dispatch/
COPY packages/domain/ packages/domain/
COPY apps/web/ apps/web/

RUN pnpm --filter @nojv/db build
RUN pnpm --filter @nojv/core build
RUN pnpm --filter @nojv/redis build
RUN pnpm --filter @nojv/storage build
RUN pnpm --filter @nojv/job-dispatch build
RUN pnpm --filter @nojv/domain build
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm --filter @nojv/web build

# 3. Production image
FROM node:26-alpine

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs appuser

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
COPY --from=builder --chown=appuser:nodejs /build/packages/domain/dist/ ./packages/domain/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/domain/package.json ./packages/domain/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/domain/node_modules/ ./packages/domain/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/dist/ ./packages/redis/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/package.json ./packages/redis/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/node_modules/ ./packages/redis/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/storage/dist/ ./packages/storage/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/storage/package.json ./packages/storage/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/job-dispatch/dist/ ./packages/job-dispatch/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/job-dispatch/package.json ./packages/job-dispatch/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/job-dispatch/node_modules/ ./packages/job-dispatch/node_modules/

# Prisma generated client output (prisma-client generator)
COPY --from=builder --chown=appuser:nodejs /build/packages/db/generated/prisma/ ./packages/db/generated/prisma/

# Keep app directory depth so pnpm relative symlinks remain valid in runtime.
COPY --from=builder --chown=appuser:nodejs /build/apps/web/build ./apps/web/build
COPY --from=builder --chown=appuser:nodejs /build/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=appuser:nodejs /build/apps/web/node_modules/ ./apps/web/node_modules/

WORKDIR /app/apps/web

ENV NODE_ENV=production
EXPOSE 3000

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "build"]
