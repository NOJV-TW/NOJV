FROM node:24-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install -g pnpm@10.33.0

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches/ patches/
COPY packages/db/package.json packages/db/
COPY packages/db/prisma.config.ts packages/db/

RUN pnpm install --frozen-lockfile --filter @nojv/db

COPY packages/db/prisma/ packages/db/prisma/

RUN pnpm --filter @nojv/db db:generate

CMD ["pnpm", "--filter", "@nojv/db", "db:deploy"]
