FROM node:22-bookworm-slim
WORKDIR /app
COPY apps/proxy/package.json ./
RUN npm install --omit=dev
COPY apps/proxy/server.cjs ./
USER node
ENV PORT=8080 MC_HOST=orchestrator WORLD_PORT_START=31000 WORLD_PORT_END=31099
EXPOSE 8080
CMD ["node","server.cjs"]
