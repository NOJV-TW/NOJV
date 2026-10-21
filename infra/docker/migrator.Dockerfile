FROM docker.io/alpine/k8s:1.36.4@sha256:358ddfc2d6ff3f00dd461dbd79aaa6d6738709f225b8da0945bb63bd4dbc304e AS kubernetes

FROM node:24.22.1-alpine@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install -g pnpm@12.9.1

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

RUN --mount=type=cache,id=pnpm-store-alpine,target=/pnpm/store pnpm install --frozen-lockfile --filter @nojv/db...

ENV pnpm_config_verify_deps_before_run=false

COPY packages/db/prisma/ packages/db/prisma/

RUN pnpm --filter @nojv/db db:generate

USER 1001

CMD ["sh", "packages/db/prisma/scripts/deploy-release.sh"]
