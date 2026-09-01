FROM docker.io/alpine/k8s:1.36.4@sha256:358ddfc2d6ff3f00dd461dbd79aaa6d6738709f225b8da0945bb63bd4dbc304e AS kubernetes

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

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
