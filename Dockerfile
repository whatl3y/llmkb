FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm install tsx
COPY --from=build /app/dist/web ./dist/web
COPY src ./src
COPY scripts ./scripts
COPY CLAUDE.md kb.config.json ./
RUN chmod +x scripts/docker-entrypoint.sh && \
    mkdir -p data/raw/articles data/raw/papers data/raw/text \
    data/wiki/concepts data/wiki/entities data/wiki/sources \
    data/wiki/syntheses data/wiki/outputs \
    data/uploads data/auth
EXPOSE 3000
ENTRYPOINT ["scripts/docker-entrypoint.sh"]
