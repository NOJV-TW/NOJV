FROM node:24-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nojv/workspace build

EXPOSE 4173

CMD ["pnpm", "--filter", "@nojv/workspace", "preview", "--host", "0.0.0.0", "--port", "4173"]
