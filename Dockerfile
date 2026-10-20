FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src/ ./src/
RUN npm run build

FROM node:26-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV CONFIG_PATH=/app/config/config.json DB_PATH=/app/data/triage.sqlite
VOLUME ["/app/data"]
CMD ["node", "dist/main.js"]
