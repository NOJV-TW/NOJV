FROM node:24-alpine

ENV HOME="/home/sandbox"
ENV PNPM_HOME="/home/sandbox/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apk add --no-cache bash build-base cargo openjdk21-jdk python3 rust \
  && corepack enable \
  && addgroup -S sandbox -g 10001 \
  && adduser -S -D -h /home/sandbox -u 10001 -G sandbox sandbox \
  && mkdir -p /workspace /tmp "$PNPM_HOME" \
  && chown -R sandbox:sandbox /workspace /tmp /home/sandbox

WORKDIR /workspace
USER sandbox

CMD ["sh"]
