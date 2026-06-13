FROM node:24-alpine

WORKDIR /app
COPY proxy.mjs ./proxy.mjs

USER node
EXPOSE 8888

CMD ["node", "proxy.mjs"]
