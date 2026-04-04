FROM node:24-alpine AS builder

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
COPY packages/job-dispatch/package.json packages/job-dispatch/

RUN pnpm install --frozen-lockfile --filter @nojv/web...

# 2. Copy source and build in dependency order
COPY packages/core/ packages/core/
COPY packages/db/ packages/db/
COPY packages/redis/ packages/redis/
COPY packages/job-dispatch/ packages/job-dispatch/
COPY packages/domain/ packages/domain/
COPY apps/web/ apps/web/

RUN pnpm --filter @nojv/db build
RUN pnpm --filter @nojv/core build
RUN pnpm --filter @nojv/redis build
RUN pnpm --filter @nojv/job-dispatch build
RUN pnpm --filter @nojv/domain build
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm --filter @nojv/web build

# 3. Production image
FROM node:24-alpine

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs appuser

WORKDIR /app

# SvelteKit server bundle
COPY --from=builder --chown=appuser:nodejs /build/apps/web/build ./build
COPY --from=builder --chown=appuser:nodejs /build/apps/web/package.json .

# Full node_modules — pnpm hoists all npm packages here and
# creates @nojv/* symlinks pointing to ../../packages/<name>.
COPY --from=builder --chown=appuser:nodejs /build/node_modules/ ./node_modules/

# Workspace package dist + package.json — the symlinks above resolve to these.
COPY --from=builder --chown=appuser:nodejs /build/packages/core/dist/ ./packages/core/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/core/package.json ./packages/core/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/db/dist/ ./packages/db/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/db/package.json ./packages/db/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/domain/dist/ ./packages/domain/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/domain/package.json ./packages/domain/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/dist/ ./packages/redis/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/package.json ./packages/redis/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/job-dispatch/dist/ ./packages/job-dispatch/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/job-dispatch/package.json ./packages/job-dispatch/package.json

# Prisma generated client output (prisma-client generator)
COPY --from=builder --chown=appuser:nodejs /build/packages/db/generated/prisma/ ./packages/db/generated/prisma/

ENV NODE_ENV=production
EXPOSE 3000

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "build"]
