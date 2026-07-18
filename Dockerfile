# syntax=docker/dockerfile:1

# ---- 前端构建 ----
FROM node:20-alpine AS client-builder
WORKDIR /app
# vite.config.ts 构建期会读取 server/seoFiles.js、scripts/app-version.mjs、release-notes.json
COPY server ./server
COPY scripts ./scripts
COPY release-notes.json ./release-notes.json
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm ci
COPY client ./client
RUN cd client && npm run build

# ---- 后端生产依赖 ----
FROM node:20-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev

# ---- 运行时镜像 ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY --from=client-builder /app/client/dist ./client/dist
RUN mkdir -p ./server/downloads

EXPOSE 4000
WORKDIR /app/server
CMD ["node", "index.js"]
