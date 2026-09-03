FROM gradle:8.14.3-jdk21 AS plugin-build
WORKDIR /src
COPY apps/server-plugin/ ./
RUN gradle --no-daemon clean build

# Keep Node 22 on Debian Bookworm, but source Java 21 from an image that
# actually ships the runtime instead of relying on Bookworm's apt repos.
FROM eclipse-temurin:21-jre-jammy AS java-runtime

FROM node:22-bookworm-slim
COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && java -version
WORKDIR /opt/hem
COPY apps/orchestrator/package.json ./package.json
COPY apps/orchestrator/server.mjs ./server.mjs
COPY apps/orchestrator/world-config.mjs ./world-config.mjs
COPY apps/orchestrator/world-version.mjs ./world-version.mjs
COPY apps/orchestrator/presence.mjs ./presence.mjs
COPY --from=plugin-build /src/build/libs/hem-gate.jar /opt/hem/HEMGate.jar
RUN mkdir -p /data/worlds
ENV WORLD_ROOT=/data/worlds PAPER_VERSION=1.21.5 PAPER_BUILD=114 PAPER_SHA256=2ae6ae22adf417699746e0f89fc2ef6cb6ee050a5f6608cee58f0535d60b509e PAPER_JAR=/opt/hem/paper.jar HEM_PLUGIN_JAR=/opt/hem/HEMGate.jar PORT=3000
EXPOSE 3000 31000-31099
CMD ["node","server.mjs"]
