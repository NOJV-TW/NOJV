FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS builder

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
RUN mkdir -p /judge-toolchain/node_modules/@types \
  && cp -RL "$(pnpm root -w)/typescript" /judge-toolchain/node_modules/typescript \
  && cp -RL "$(pnpm root -w)/@types/node" /judge-toolchain/node_modules/@types/node

FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3

COPY packages/core/src/judge-environment.json /runner/judge-environment.json

RUN test "$(cat /etc/alpine-release)" = "$(node -p "require('/runner/judge-environment.json').platform.version")" \
  && test "$(node --version)" = "v$(node -p "require('/runner/judge-environment.json').platform.nodeVersion")" \
  && apk add --no-cache $(node -e "const { apkPackages } = require('/runner/judge-environment.json'); process.stdout.write(Object.entries(apkPackages).map(([name, version]) => name + '=' + version).join(' '))") \
  && addgroup -S sandbox -g 10001 \
  && adduser -S -D -h /home/sandbox -u 10001 -G sandbox sandbox \
  && mkdir -p /runner /workspace /tmp \
  && chown -R sandbox:sandbox /runner /workspace /tmp /home/sandbox

COPY --from=builder /build/apps/sandbox-runner/dist/ /runner/
COPY --from=builder /judge-toolchain/node_modules/ /node_modules/
RUN ln -s /node_modules/typescript/bin/tsc /usr/local/bin/tsc
# Python wrapper assets must travel with the runner. compiler.ts resolves
# them at `<dirname-of-compiler.js>/../assets/wrappers/...`, so with
# compiler.js at /runner/compiler.js the wrappers must live at
# /assets/wrappers/.
COPY apps/sandbox-runner/assets/wrappers/ /assets/wrappers/

ENV HOME="/tmp"
WORKDIR /workspace
USER sandbox

CMD ["node", "/runner/index.js"]
