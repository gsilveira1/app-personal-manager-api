# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests and Prisma schema first (layer cache)
COPY package*.json ./
COPY tsconfig*.json ./
COPY prisma ./prisma/

# Install all deps (including devDeps needed to compile)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source and build
COPY src/ ./src/
RUN npm run build

# Prune devDependencies so only production deps are copied
RUN npm prune --production

# --- Stage 2: Production Runner ---
FROM node:20-alpine AS runner

# dumb-init: minimal PID 1 that correctly forwards SIGTERM (required for Fly.io graceful shutdown)
# postgresql-client: provides pg_isready for the start.sh health check loop
RUN apk add --no-cache dumb-init postgresql-client

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy production artifacts and start script, owned by the non-root 'node' user
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --chown=node:node start.sh ./start.sh

# Guarantee execute permissions on entrypoint script
RUN chmod +x ./start.sh

# Switch to non-root user for principle of least privilege
USER node

EXPOSE 8080

ENTRYPOINT ["dumb-init", "--", "./start.sh"]
CMD ["node", "dist/main"]
