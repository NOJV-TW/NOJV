FROM node:24-alpine

WORKDIR /app
COPY proxy.mjs ./proxy.mjs

USER 10001
EXPOSE 8888

CMD ["node", "proxy.mjs"]
