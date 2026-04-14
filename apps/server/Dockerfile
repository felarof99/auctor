FROM oven/bun:1.3.6-alpine

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/

RUN bun install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/

EXPOSE 3001

CMD ["bun", "run", "apps/server/src/index.ts"]
