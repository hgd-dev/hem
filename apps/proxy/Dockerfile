FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY apps/proxy/package.json ./
RUN npm install --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/proxy/package.json ./package.json
COPY apps/proxy/server.cjs ./
USER node
ENV PORT=8080 MC_HOST=orchestrator WORLD_PORT_START=31000 WORLD_PORT_END=31099
EXPOSE 8080
CMD ["node","server.cjs"]
