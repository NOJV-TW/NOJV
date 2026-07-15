FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install -g pnpm@11.13.0

WORKDIR /build

# 1. Copy dependency manifests for cache-friendly install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches/ patches/
COPY tsconfig.base.json ./
COPY tooling/eslint/package.json tooling/eslint/
COPY tooling/prettier/package.json tooling/prettier/
COPY tooling/typescript/package.json tooling/typescript/
COPY tooling/typescript/base.json tooling/typescript/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/application/package.json packages/application/
COPY packages/redis/package.json packages/redis/
COPY packages/storage/package.json packages/storage/
COPY packages/mailer/package.json packages/mailer/
COPY packages/temporal/package.json packages/temporal/

RUN pnpm install --frozen-lockfile --filter @nojv/web...

ENV pnpm_config_verify_deps_before_run=false

# @grpc/grpc-js is marked ssr.external in the web build, so the SSR output emits a
# bare require('@grpc/grpc-js') at runtime. pnpm leaves it nested in the virtual
# store with no top-level entry, so hoist a symlink into the root node_modules
# where Node can resolve it from the build output.
RUN cd node_modules \
  && REL="$(ls -d .pnpm/@grpc+grpc-js@*/node_modules/@grpc/grpc-js | head -1)" \
  && mkdir -p @grpc \
  && ln -sf "../$REL" @grpc/grpc-js

# 2. Copy source and build in dependency order
COPY packages/core/ packages/core/
COPY packages/db/ packages/db/
COPY packages/redis/ packages/redis/
COPY packages/storage/ packages/storage/
COPY packages/mailer/ packages/mailer/
COPY packages/temporal/ packages/temporal/
COPY packages/application/ packages/application/
COPY apps/web/ apps/web/

RUN pnpm --filter @nojv/db build
RUN pnpm --filter @nojv/core build
RUN pnpm --filter @nojv/redis build
RUN pnpm --filter @nojv/storage build
RUN pnpm --filter @nojv/mailer build
RUN pnpm --filter @nojv/temporal build
RUN pnpm --filter @nojv/application build
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm --filter @nojv/web build

# 3. Production image
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

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
COPY --from=builder --chown=appuser:nodejs /build/packages/temporal/dist/ ./packages/temporal/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/temporal/package.json ./packages/temporal/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/temporal/node_modules/ ./packages/temporal/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/dist/ ./packages/redis/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/package.json ./packages/redis/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/node_modules/ ./packages/redis/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/storage/dist/ ./packages/storage/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/storage/package.json ./packages/storage/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/mailer/dist/ ./packages/mailer/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/mailer/package.json ./packages/mailer/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/mailer/node_modules/ ./packages/mailer/node_modules/

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
  CMD node -e "fetch('http://localhost:3000/api/livez').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "build"]
