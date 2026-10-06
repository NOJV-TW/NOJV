FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Needed for tree-sitter + @dodona/dolos-parsers native addon build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.28.2

WORKDIR /build

# 1. Copy dependency manifests for cache-friendly install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches/ patches/
COPY tsconfig.base.json tsdown.base.mjs ./
COPY tooling/eslint/package.json tooling/eslint/
COPY tooling/prettier/package.json tooling/prettier/
COPY tooling/typescript/package.json tooling/typescript/
COPY tooling/typescript/base.json tooling/typescript/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/temporal/package.json packages/temporal/
COPY packages/application/package.json packages/application/
COPY packages/redis/package.json packages/redis/
COPY packages/storage/package.json packages/storage/
COPY packages/mailer/package.json packages/mailer/
COPY packages/sandbox-docker/package.json packages/sandbox-docker/

RUN --mount=type=cache,id=pnpm-store-bookworm,target=/pnpm/store pnpm install --frozen-lockfile --filter @nojv/worker...

ENV pnpm_config_verify_deps_before_run=false

# 2. Copy source and build in dependency order
COPY packages/core/ packages/core/
COPY packages/db/ packages/db/
COPY packages/redis/ packages/redis/
COPY packages/storage/ packages/storage/
COPY packages/mailer/ packages/mailer/
COPY packages/sandbox-docker/ packages/sandbox-docker/
COPY packages/application/ packages/application/
COPY packages/temporal/ packages/temporal/
COPY apps/worker/ apps/worker/

RUN pnpm --filter @nojv/db build
RUN pnpm --filter @nojv/core build
RUN pnpm --filter @nojv/redis build
RUN pnpm --filter @nojv/storage build
RUN pnpm --filter @nojv/mailer build
RUN pnpm --filter @nojv/sandbox-docker build
RUN pnpm --filter @nojv/application build
RUN pnpm --filter @nojv/temporal build
RUN pnpm --filter @nojv/worker build \
  && rm -rf node_modules/.pnpm-task-run-state-v1

FROM rust:1.97.1-bookworm@sha256:14bc9c5966e7b3a385794b3d5389a8765668342025fbcc7b2e3d2866ac4bd8c3 AS wasm-oj-runtime

ARG WASM_OJ_FORGE_TAG=v0.2.3
ARG WASM_OJ_FORGE_COMMIT=28cd0aced28199a48005854fc513d5f84e1fd4f8

WORKDIR /src

RUN git init -q . \
  && git remote add origin https://github.com/wasm-oj/forge.git \
  && git fetch -q --depth 1 --filter=blob:none origin "refs/tags/${WASM_OJ_FORGE_TAG}" \
  && test "$(git rev-parse 'FETCH_HEAD^{commit}')" = "$WASM_OJ_FORGE_COMMIT" \
  && git sparse-checkout set --no-cone /crates/runtime-core/ /vendor/ \
  && git checkout -q --detach "$WASM_OJ_FORGE_COMMIT"

RUN cargo build --locked --manifest-path crates/runtime-core/Cargo.toml --release \
    --bin wasm-oj-runner --bin wasm-oj-compiler \
  && install -D -m 0755 -s -t /rootfs/opt/wasm-oj/bin \
    crates/runtime-core/target/release/wasm-oj-runner \
    crates/runtime-core/target/release/wasm-oj-compiler \
  && find /rootfs -exec touch -h -d @0 {} +

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS wasm-oj-toolchains

WORKDIR /rootfs/opt/wasm-oj/toolchains
COPY infra/docker/wasm-oj-toolchains/package.json infra/docker/wasm-oj-toolchains/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
  && find /rootfs -exec touch -h -d @0 {} +

# 3. Production image
FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --create-home appuser

COPY --link --from=wasm-oj-runtime /rootfs/ /
COPY --link --from=wasm-oj-toolchains /rootfs/ /

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
COPY --from=builder --chown=appuser:nodejs /build/packages/application/dist/ ./packages/application/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/application/package.json ./packages/application/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/application/node_modules/ ./packages/application/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/dist/ ./packages/redis/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/package.json ./packages/redis/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/redis/node_modules/ ./packages/redis/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/storage/dist/ ./packages/storage/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/storage/package.json ./packages/storage/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/storage/node_modules/ ./packages/storage/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/mailer/dist/ ./packages/mailer/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/mailer/package.json ./packages/mailer/package.json
COPY --from=builder --chown=appuser:nodejs /build/packages/mailer/node_modules/ ./packages/mailer/node_modules/
COPY --from=builder --chown=appuser:nodejs /build/packages/sandbox-docker/dist/ ./packages/sandbox-docker/dist/
COPY --from=builder --chown=appuser:nodejs /build/packages/sandbox-docker/package.json ./packages/sandbox-docker/package.json

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
