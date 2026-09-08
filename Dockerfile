FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
COPY migrations ./migrations
COPY config ./config
COPY assets ./assets

RUN npm run deploy:check

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV LOCK_PATH=/tmp/lfr-store-bot.lock
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/config ./config
COPY --from=build /app/assets ./assets

RUN mkdir -p /app/data && chown -R node:node /app
USER node

VOLUME ["/app/data"]
CMD ["node", "dist/src/index.js"]
