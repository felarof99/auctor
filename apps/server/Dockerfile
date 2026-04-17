FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock* bunfig.toml ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
RUN BUN_INSTALL_FROZEN_LOCKFILE=false bun install

FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=install /app/packages/shared/node_modules ./packages/shared/node_modules
COPY apps/server/src ./apps/server/src
COPY apps/server/package.json ./apps/server/
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/src ./packages/database/src
COPY packages/database/package.json ./packages/database/
COPY package.json ./
RUN mkdir -p /data/repos /data/cache
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "apps/server/src/index.ts"]
