# ── Single-image deploy: builds the React client and serves it from the API ──
FROM node:22-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-slim AS server
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json server/prisma.config.js ./
COPY server/prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts && npm install --no-save --ignore-scripts prisma@7.10.1 && npx prisma generate
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
ENV NODE_ENV=production PORT=5000
EXPOSE 5000
# Apply committed migrations if present; otherwise sync the schema (first deploy / demo).
CMD ["sh", "-c", "if [ -d prisma/migrations ]; then npx prisma migrate deploy; else npx prisma db push; fi && node src/server.js"]
