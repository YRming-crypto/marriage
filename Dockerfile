ARG NODE_VERSION=22.12.0-bookworm-slim
ARG NGINX_VERSION=1.27.4-alpine

FROM node:${NODE_VERSION} AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,target=/root/.npm npm ci
COPY prisma ./prisma
RUN npm exec prisma -- generate --schema prisma/schema.prisma

FROM dependencies AS build
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:${NODE_VERSION} AS api
ENV NODE_ENV=production \
    API_PORT=4184
WORKDIR /workspace
RUN apt-get update \
    && apt-get install --no-install-recommends -y socat tini \
    && rm -rf /var/lib/apt/lists/*
COPY --from=production-dependencies /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/packages/shared/dist ./packages/shared/dist
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY --chmod=755 deploy/api/entrypoint.sh /usr/local/bin/api-entrypoint
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/api-entrypoint"]

FROM api AS demo-seed
COPY apps/web/public/images ./apps/web/public/images
ENTRYPOINT ["node", "apps/api/dist/database-seed-cli.js"]

FROM dependencies AS migrate
WORKDIR /workspace
COPY prisma ./prisma
USER node
ENTRYPOINT ["npm", "exec", "prisma", "--"]
CMD ["migrate", "deploy", "--schema", "prisma/schema.prisma"]

FROM nginx:${NGINX_VERSION} AS web
COPY deploy/web/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["nginx", "-g", "daemon off;"]

FROM nginx:${NGINX_VERSION} AS gateway
COPY deploy/gateway/nginx.conf /etc/nginx/nginx.conf.template
COPY --chmod=755 deploy/gateway/entrypoint.sh /usr/local/bin/gateway-entrypoint
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/gateway-entrypoint"]
