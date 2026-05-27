FROM node:26-alpine AS builder

RUN npm install -g pnpm@10.33.0

WORKDIR /build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY patches/ patches/
COPY tooling/typescript/base.json tooling/typescript/
COPY apps/sandbox-runner/package.json apps/sandbox-runner/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --filter @nojv/sandbox-runner...

COPY packages/core/ packages/core/
COPY apps/sandbox-runner/ apps/sandbox-runner/
RUN pnpm --filter @nojv/core build
RUN pnpm --filter @nojv/sandbox-runner build

FROM node:26-alpine

RUN apk add --no-cache bash build-base cargo go openjdk21-jdk python3 rust \
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
# Vendored Codeforces testlib.h — installed globally so g++ can resolve
# `#include "testlib.h"` from any working directory. MIT requires the
# permission notice to travel with every copy, so ship the LICENSE at
# the Debian-conventional /usr/share/licenses/ path alongside it.
COPY apps/sandbox-runner/assets/testlib/testlib.h /usr/include/testlib.h
COPY apps/sandbox-runner/assets/testlib/LICENSE /usr/share/licenses/testlib/LICENSE

ENV HOME="/tmp"
# Fork-bomb defence: cap the sandbox UID to 64 live processes. Gated by env
# so dev/CI machines (where tests run as a user that already has hundreds of
# processes) don't hit EAGAIN. See apps/sandbox-runner/src/utils.ts.
ENV SANDBOX_NPROC_LIMIT=64
WORKDIR /workspace
USER sandbox

CMD ["node", "/runner/index.js"]
