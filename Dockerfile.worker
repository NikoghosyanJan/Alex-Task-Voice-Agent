# syntax=docker/dockerfile:1.7
# Build context: repository root (see docker-compose.yml)

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat && npm install -g pnpm@10.33.2
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/jobs/package.json packages/jobs/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma packages/db/prisma
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @taskbot/db generate && pnpm --filter @taskbot/worker build

# One-off migration runner used by the `migrate` compose service.
FROM build AS migrate
CMD ["pnpm", "--filter", "@taskbot/db", "migrate:deploy"]

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
USER node
WORKDIR /app/apps/worker
CMD ["node", "--enable-source-maps", "dist/index.js"]
