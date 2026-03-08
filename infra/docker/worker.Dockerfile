FROM node:24-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apk add --no-cache docker-cli
RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nojv/db db:generate
RUN pnpm --filter @nojv/worker build

CMD ["pnpm", "--filter", "@nojv/worker", "start"]
