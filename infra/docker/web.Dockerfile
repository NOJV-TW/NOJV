FROM node:24-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /build

# 1. Copy dependency manifests for cache-friendly install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tooling/typescript/base.json tooling/typescript/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/

RUN pnpm install --frozen-lockfile --filter @nojv/web...

# 2. Copy source and build
COPY packages/core/ packages/core/
COPY packages/db/ packages/db/
COPY packages/queue/ packages/queue/
COPY apps/web/ apps/web/

RUN pnpm --filter @nojv/db db:generate
RUN pnpm --filter @nojv/core build
RUN pnpm --filter @nojv/web build

# 3. Production image — only the SvelteKit build output
FROM node:24-alpine

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs appuser

WORKDIR /app

COPY --from=builder --chown=appuser:nodejs /build/apps/web/build ./build
COPY --from=builder --chown=appuser:nodejs /build/apps/web/package.json .

ENV NODE_ENV=production
EXPOSE 3000

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "build"]
