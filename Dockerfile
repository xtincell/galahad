# Galahad engine image — one image runs any role (chef | guardian | traveler),
# selected at runtime by GALAHAD_ROLE. Zero build step, zero npm dependencies.
FROM node:22-alpine

# git + docker CLI so agents can survey containers and build in the workspace.
RUN apk add --no-cache git docker-cli curl bash

WORKDIR /app
COPY engine/package.json ./package.json
COPY engine/src ./src
COPY engine/roles ./roles

ENV NODE_ENV=production
# Runtime config is 100% environment-driven (see .env.example). No secrets baked in.
CMD ["node", "src/index.js"]
