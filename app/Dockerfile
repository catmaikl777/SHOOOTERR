FROM node:20-alpine

USER node
WORKDIR /app

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .

ENV NODE_ENV=production

# Порт WebSocket-сервера — уточните в server.js!
EXPOSE 8080

CMD ["node", "server.js"]
