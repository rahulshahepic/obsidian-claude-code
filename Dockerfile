# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: build the SvelteKit app
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
COPY app/package*.json ./
RUN npm ci
COPY app/ .
RUN npm run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: production dependencies only (no devDeps, keeps the image lean)
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS prod-deps
WORKDIR /app
COPY app/package*.json ./
RUN npm ci --omit=dev

# ──────────────────────────────────────────────────────────────────────────────
# Stage 3: final runtime image
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-slim

# Install Docker CLI so the app can `docker exec` into the workspace container
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg \
       | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
       https://download.docker.com/linux/debian bookworm stable" \
       > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json .
COPY --from=builder /app/drizzle ./drizzle

# Wrapper script: app calls this to exec into the workspace container
COPY container/docker-exec-wrapper.sh /usr/local/bin/docker-exec-wrapper.sh
RUN chmod +x /usr/local/bin/docker-exec-wrapper.sh

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "build"]
