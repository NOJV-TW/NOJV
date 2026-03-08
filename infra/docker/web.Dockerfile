FROM node:24-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nojv/db db:generate
RUN pnpm --filter @nojv/web build

EXPOSE 3000

CMD ["pnpm", "--filter", "@nojv/web", "start"]
