FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

COPY packages/core/src/judge-environment.json /runner/judge-environment.json

RUN test "$(cat /etc/alpine-release)" = "$(node -p "require('/runner/judge-environment.json').platform.version")" \
  && test "$(node --version)" = "v$(node -p "require('/runner/judge-environment.json').platform.nodeVersion")" \
  && apk add --no-cache $(node -e "const { apkPackages } = require('/runner/judge-environment.json'); process.stdout.write(Object.entries(apkPackages).map(([name, version]) => name + '=' + version).join(' '))") \
  && addgroup -S sandbox -g 10001 \
  && adduser -S -D -h /home/sandbox -u 10001 -G sandbox sandbox \
  && mkdir -p /runner /workspace /tmp \
  && chown -R sandbox:sandbox /runner /workspace /tmp /home/sandbox
