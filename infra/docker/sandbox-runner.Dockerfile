FROM node:24-alpine AS builder

RUN corepack enable

WORKDIR /build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY tooling/typescript/base.json tooling/typescript/
COPY apps/sandbox-runner/package.json apps/sandbox-runner/
COPY packages/core/package.json packages/core/
COPY packages/sandbox/package.json packages/sandbox/
RUN pnpm install --frozen-lockfile --filter @nojv/sandbox-runner...

COPY packages/core/ packages/core/
COPY packages/sandbox/ packages/sandbox/
COPY apps/sandbox-runner/ apps/sandbox-runner/
RUN pnpm --filter @nojv/core build
RUN pnpm --filter @nojv/sandbox build
RUN pnpm --filter @nojv/sandbox-runner build

FROM node:24-alpine

RUN apk add --no-cache bash build-base cargo go openjdk21-jdk python3 rust \
  && addgroup -S sandbox -g 10001 \
  && adduser -S -D -h /home/sandbox -u 10001 -G sandbox sandbox \
  && mkdir -p /runner /workspace /tmp \
  && chown -R sandbox:sandbox /runner /workspace /tmp /home/sandbox

COPY --from=builder /build/apps/sandbox-runner/dist/ /runner/

ENV HOME="/tmp"
WORKDIR /workspace
USER sandbox

CMD ["node", "/runner/index.js"]
