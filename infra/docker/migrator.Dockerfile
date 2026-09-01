FROM docker.io/alpine/k8s:1.36.2@sha256:44ef4942e171939b9c665a4a84beb80e2dcdb9a24330d4651cfdfd2e9deecc47 AS kubernetes

FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install -g pnpm@11.13.0

WORKDIR /app

COPY --from=kubernetes /usr/bin/kubectl /usr/local/bin/kubectl

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches/ patches/
COPY tsconfig.base.json tsdown.base.mjs ./
COPY tooling/eslint/package.json tooling/eslint/
COPY tooling/prettier/package.json tooling/prettier/
COPY tooling/typescript/package.json tooling/typescript/
COPY tooling/typescript/base.json tooling/typescript/
COPY packages/db/package.json packages/db/
COPY packages/db/prisma.config.ts packages/db/
COPY packages/core/package.json packages/core/
COPY packages/storage/package.json packages/storage/

RUN pnpm install --frozen-lockfile --filter @nojv/db...

ENV pnpm_config_verify_deps_before_run=false

COPY packages/core/ packages/core/
COPY packages/storage/ packages/storage/
COPY packages/db/prisma/ packages/db/prisma/

RUN pnpm --filter @nojv/core build \
  && pnpm --filter @nojv/storage build \
  && pnpm --filter @nojv/db db:generate

CMD ["sh", "packages/db/prisma/scripts/deploy-release.sh"]
