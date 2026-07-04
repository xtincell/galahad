# Claude bridge image — wraps the Claude CLI as an internal HTTP tool.
# Requires ANTHROPIC_API_KEY at runtime (or a mounted Claude auth). Optional:
# enable with `docker compose --profile bridge up`.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY bridge/server.js ./server.js
COPY bridge/package.json ./package.json

ENV NODE_ENV=production BRIDGE_HOST=0.0.0.0 BRIDGE_PORT=8799
EXPOSE 8799
CMD ["node", "server.js"]
