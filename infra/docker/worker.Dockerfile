FROM node:24-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /build

# 1. Copy dependency manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tooling/typescript/base.json tooling/typescript/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/

RUN pnpm install --frozen-lockfile --filter @nojv/worker...

# 2. Copy source and build
COPY packages/core/ packages/core/
COPY packages/db/ packages/db/
COPY apps/worker/ apps/worker/

RUN pnpm --filter @nojv/db db:generate
RUN pnpm --filter @nojv/core build
RUN pnpm --filter @nojv/worker build

# 3. Production image
FROM node:24-alpine

RUN apk add --no-cache docker-cli

WORKDIR /app

COPY --from=builder /build/apps/worker/dist/ ./dist/
COPY --from=builder /build/apps/worker/package.json .
COPY --from=builder /build/apps/worker/node_modules/ ./node_modules/
COPY --from=builder /build/packages/db/node_modules/.prisma/ ./node_modules/.prisma/

ENV NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/healthz').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
