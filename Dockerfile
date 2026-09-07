# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install deps first (better layer caching). Skip lifecycle scripts so
# `postinstall` (`prisma generate`) does not run before the schema is present.
COPY package*.json ./
RUN npm ci --ignore-scripts

# Schema + config are required by Prisma 7 (`prisma.config.ts` points at prisma/schema.prisma).
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY . .
RUN npx prisma generate
RUN npm run build

# ── Runtime stage ───────────────────────────────────────────────────────────────
FROM node:20-slim AS runner

# better-sqlite3 needs python3/make/g++ at runtime for any native rebuilds
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Copy only what's needed to run
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated

# Prisma migration runs at startup via the entrypoint script
COPY --from=builder /app/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3001

CMD ["./entrypoint.sh"]
