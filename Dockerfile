# ==============================================================================
# Multi-Stage Production Dockerfile for MBG Assistant (BGN SPPG Bot)
# Base: Node.js 22 LTS on Alpine Linux with Sharp & Vips native support
# ==============================================================================

# Stage 1: Build & Compile TypeScript
FROM node:22-alpine AS builder

WORKDIR /app

# Install native build tools for compiling native bindings (e.g. sharp)
RUN apk add --no-cache python3 make g++ vips-dev

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build
RUN npm prune --omit=dev

# ==============================================================================
# Stage 2: Minimal Production Image
FROM node:22-alpine AS runner

WORKDIR /app

# Install lightweight runtime dependencies (vips for Sharp WebP, dumb-init for PID 1 signal handling)
RUN apk add --no-cache vips dumb-init

ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV PORT=8080
ENV EXECUTION_MODE=single
ENV NODE_OPTIONS="--max-old-space-size=350"

EXPOSE 8080

# Copy production artifacts from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Use non-root node user for security
RUN chown -R node:node /app
USER node

# Signal-aware PID 1 process
ENTRYPOINT ["dumb-init", "--"]

# Run Master Supervisor
CMD ["node", "dist/supervisor.js"]
