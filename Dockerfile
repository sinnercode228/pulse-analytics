# syntax=docker/dockerfile:1

# ---- build: API bundle, tracker and dashboard (API mode, served from /) ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build -w @pulse/server \
 && PAGES_BASE=/ VITE_DATA_SOURCE=api npm run build -w @pulse/web

# ---- runtime: production deps only ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATABASE_PATH=/data/pulse.db \
    STATIC_DIR=/app/web
WORKDIR /app/server
COPY package.json package-lock.json /app/
COPY packages/core/package.json /app/packages/core/
COPY server/package.json /app/server/
COPY web/package.json /app/web/package.json
RUN cd /app && npm ci --omit=dev -w @pulse/server --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/public ./public
COPY --from=build /app/web/dist /app/web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]
