# ── stage 1: frontend ────────────────────────────────────────────────────────
# Vite is built for Node, and Bun's runtime OOMs running it on amd64 (exit 134,
# "MemoryExhaustion"). It passed locally on arm64 and failed every time on
# Railway, which is a miserable way to discover an architecture difference.
# Node builds it without drama; Bun still runs the server in stage 2.
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ── stage 2: server ──────────────────────────────────────────────────────────
# Debian-based, not alpine: sharp needs glibc.
FROM oven/bun:1
WORKDIR /app

# Dependencies first so a source-only change doesn't reinstall everything.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile || bun install

COPY . .
# Built frontend from stage 1. The server serves it from the same origin.
COPY --from=web /web/dist ./web/dist

# Railway injects PORT; the server reads it. This line is documentation.
EXPOSE 3177

# Volume-backed paths. Railway overrides these with the real mount.
ENV ASSYZE_DB=/data/assyze.db
ENV ASSYZE_PHOTOS=/data/photos

CMD ["bun", "run", "src/api/index.ts"]
