FROM docker.io/alpine/k8s:1.33.3@sha256:47e4ea4c263fb4e14e51d7c5ca841da756673f18e2340f38c0cf1f7219d05e85 AS kubernetes

FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install -g pnpm@10.33.0

WORKDIR /app

COPY --from=kubernetes /usr/bin/kubectl /usr/local/bin/kubectl

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches/ patches/
COPY tsconfig.base.json ./
COPY tooling/typescript/base.json tooling/typescript/
COPY packages/db/package.json packages/db/
COPY packages/db/prisma.config.ts packages/db/
COPY packages/core/package.json packages/core/
COPY packages/storage/package.json packages/storage/

RUN pnpm install --frozen-lockfile --filter @nojv/db...

COPY packages/core/ packages/core/
COPY packages/storage/ packages/storage/
COPY packages/db/prisma/ packages/db/prisma/

RUN pnpm --filter @nojv/core build \
  && pnpm --filter @nojv/storage build \
  && pnpm --filter @nojv/db db:generate

CMD ["sh", "packages/db/prisma/scripts/deploy-release.sh"]
