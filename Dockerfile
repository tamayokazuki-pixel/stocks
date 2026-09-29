# syntax=docker/dockerfile:1

# ---- Build stage: full deps, typecheck + build the frontend -------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY server ./server
RUN npm run build

# ---- Runtime stage: production deps only --------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY supabase ./supabase

USER node

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# Keep one process for now: the market poller and SSE client state are in-process.
# PostgreSQL is shared, but market updates are not yet coordinated across replicas.
CMD ["node", "server/index.js"]
