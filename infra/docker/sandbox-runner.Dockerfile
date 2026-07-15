FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS builder

RUN npm install -g pnpm@11.13.0

WORKDIR /build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY patches/ patches/
COPY tooling/eslint/package.json tooling/eslint/
COPY tooling/prettier/package.json tooling/prettier/
COPY tooling/typescript/package.json tooling/typescript/
COPY tooling/typescript/base.json tooling/typescript/
COPY apps/sandbox-runner/package.json apps/sandbox-runner/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --filter @nojv/sandbox-runner...

ENV pnpm_config_verify_deps_before_run=false

COPY packages/core/ packages/core/
COPY apps/sandbox-runner/ apps/sandbox-runner/
RUN pnpm --filter @nojv/core build
RUN pnpm --filter @nojv/sandbox-runner build

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

RUN apk add --no-cache bash build-base cargo go openjdk21-jdk python3 rust socat \
  && addgroup -S sandbox -g 10001 \
  && adduser -S -D -h /home/sandbox -u 10001 -G sandbox sandbox \
  && mkdir -p /runner /workspace /tmp \
  && chown -R sandbox:sandbox /runner /workspace /tmp /home/sandbox

COPY --from=builder /build/apps/sandbox-runner/dist/ /runner/
# Python wrapper assets must travel with the runner. compiler.ts resolves
# them at `<dirname-of-compiler.js>/../assets/wrappers/...`, so with
# compiler.js at /runner/compiler.js the wrappers must live at
# /assets/wrappers/.
COPY apps/sandbox-runner/assets/wrappers/ /assets/wrappers/

ENV HOME="/tmp"
WORKDIR /workspace
USER sandbox

CMD ["node", "/runner/index.js"]
