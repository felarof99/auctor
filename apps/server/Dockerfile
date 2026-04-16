FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock* ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --production

FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/apps/server/node_modules ./apps/server/node_modules
COPY apps/server/src ./apps/server/src
COPY apps/server/package.json ./apps/server/
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/package.json ./packages/shared/
COPY package.json ./
RUN mkdir -p /data/repos /data/cache
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "apps/server/src/index.ts"]
