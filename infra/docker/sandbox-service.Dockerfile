FROM node:24-alpine

ENV HOME="/home/sandbox"
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apk add --no-cache bash build-base cargo openjdk21-jdk python3 rust \
  && addgroup -S sandbox -g 10001 \
  && adduser -S -D -h /home/sandbox -u 10001 -G sandbox sandbox \
  && mkdir -p /app /tmp /home/sandbox \
  && chown -R sandbox:sandbox /app /tmp /home/sandbox \
  && corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nojv/sandbox build

USER sandbox

CMD ["pnpm", "--filter", "@nojv/sandbox", "start"]
