# Builds the palserver agent (with the web UI bundled) into a single image.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
ENV CI=true
COPY . .
RUN pnpm install --frozen-lockfile && pnpm -r build

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
ENV PALSERVER_REPO_DIR=/app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/LICENSE.md /app/THIRD_PARTY_LICENSES.md ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/discord-bot/package.json packages/discord-bot/
COPY --from=build /app/packages/discord-bot/dist packages/discord-bot/dist
COPY --from=build /app/packages/agent/package.json packages/agent/
COPY --from=build /app/packages/agent/dist packages/agent/dist
COPY --from=build /app/packages/web/dist packages/web/dist
# The Agent sends these contexts to the host Docker daemon when a built-in
# game image is missing. They must be present inside the Agent container.
COPY --from=build /app/images images/
RUN pnpm install --frozen-lockfile --prod --filter @palserver/agent...
EXPOSE 8250
CMD ["node", "packages/agent/dist/index.js"]
