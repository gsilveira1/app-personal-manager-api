FROM node:22-alpine AS builder

WORKDIR /app

# Copy only dependency files first to leverage Docker layer cache
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDeps needed for build)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client and build NestJS
RUN npx prisma generate
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Production stage — minimal, hardened image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine

# dumb-init is a minimal init process that correctly forwards SIGTERM to the
# Node.js process (required for fly.io graceful shutdown)
RUN apk add --no-cache dumb-init

WORKDIR /app

# Set production mode — disables dev tooling and enables production optimisations
ENV NODE_ENV=production

# Copy artifacts from builder, chown to the non-root 'node' user BEFORE switching
# to it — avoids root-owned files that the app cannot later modify if needed
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma

# Switch to non-root user for all subsequent commands and at runtime
USER node

EXPOSE 9090

# dumb-init as PID 1 ensures correct SIGTERM handling; run compiled JS directly
CMD ["dumb-init", "node", "dist/main"]