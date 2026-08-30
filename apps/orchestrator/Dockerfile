FROM gradle:8.14.3-jdk21 AS plugin-build
WORKDIR /src
COPY apps/server-plugin/ ./
RUN gradle --no-daemon clean build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jre-headless ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/hem
COPY apps/orchestrator/package.json ./package.json
COPY apps/orchestrator/server.mjs ./server.mjs
COPY --from=plugin-build /src/build/libs/hem-gate.jar /opt/hem/HEMGate.jar
RUN mkdir -p /data/worlds
ENV WORLD_ROOT=/data/worlds PAPER_VERSION=1.21.5 PAPER_BUILD=114 PAPER_SHA256=2ae6ae22adf417699746e0f89fc2ef6cb6ee050a5f6608cee58f0535d60b509e PAPER_JAR=/opt/hem/paper.jar HEM_PLUGIN_JAR=/opt/hem/HEMGate.jar PORT=3000
EXPOSE 3000 31000-31099
CMD ["node","server.mjs"]
