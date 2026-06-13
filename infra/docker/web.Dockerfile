FROM node:24-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install -g pnpm@10.33.0

WORKDIR /build

# 1. Copy dependency manifests for cache-friendly install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY tooling/typescript/base.json tooling/typescript/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/application/package.json packages/application/
COPY packages/redis/package.json packages/redis/
COPY packages/storage/package.json packages/storage/

RUN pnpm install --frozen-lockfile --filter @nojv/web...

# 2. Copy source and build in dependency order
COPY packages/core/ packages/core/
COPY packages/db/ packages/db/
COPY packages/redis/ packages/redis/
COPY packages/storage/ packages/storage/
COPY packages/application/ packages/application/
COPY apps/web/ apps/web/

RUN pnpm --filter @nojv/db build
RUN pnpm --filter @nojv/core build
RUN pnpm --filter @nojv/redis build
RUN pnpm --filter @nojv/storage build
RUN pnpm --filter @nojv/application build
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm --filter @nojv/web build

# 3. Production image
FROM node:24-alpine

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
COPY --from=builder --chown=appuser:nodejs /build/packages/application/dist/ ./packages/application/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/application/package.json ./packages/application/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/application/node_modules/ ./packages/application/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/dist/ ./packages/redis/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/package.json ./packages/redis/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/node_modules/ ./packages/redis/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/storage/dist/ ./packages/storage/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/storage/package.json ./packages/storage/package.json

# Prisma generated client output (prisma-client generator)
COPY --from=builder --chown=appuser:nodejs /build/packages/db/generated/prisma/ ./packages/db/generated/prisma/

# Keep app directory depth so pnpm relative symlinks remain valid in runtime.
COPY --from=builder --chown=appuser:nodejs /build/apps/web/build ./apps/web/build
COPY --from=builder --chown=appuser:nodejs /build/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=appuser:nodejs /build/apps/web/node_modules/ ./apps/web/node_modules/

WORKDIR /app/apps/web

ENV NODE_ENV=production
# Raise SvelteKit adapter-node body-size cap from the 512K default so the
# 60 MB POST cap on bundle/workspace/checker/interactor upload routes is the
# effective ceiling. Overridable at runtime.
ENV BODY_SIZE_LIMIT=67108864
EXPOSE 3000

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "build"]
