# ── Stage 1: install dependencies (bcrypt needs native build tools) ────────────
FROM node:18-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++ \
 && npm ci --omit=dev

# ── Stage 2: lean runtime image ────────────────────────────────────────────────
FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Remove any leftover SQLite file
RUN rm -f data.db
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1
CMD ["node", "server.js"]
