FROM node:24-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/db/package.json packages/db/

RUN pnpm install --frozen-lockfile --filter @nojv/db
RUN pnpm --filter @nojv/db db:generate

COPY packages/db/prisma/ packages/db/prisma/

CMD ["pnpm", "--filter", "@nojv/db", "db:deploy"]
