# ── stage 1: frontend ────────────────────────────────────────────────────────
# Vite is built for Node, and Bun's runtime OOMs running it on amd64 (exit 134,
# "MemoryExhaustion"). It passed locally on arm64 and failed every time on
# Railway, which is a miserable way to discover an architecture difference.
# Node builds it without drama; Bun still runs the server in stage 2.
FROM node:24.15.0-bookworm-slim AS web
COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
# Compare's part-kind contract is shared with the API; Vite imports its small
# runtime constant while erasing the type-only engine references.
COPY src/comparison/types.ts /src/comparison/types.ts
COPY src/account-sync.ts /src/account-sync.ts
RUN node node_modules/vite/bin/vite.js build

# ── stage 2: server ──────────────────────────────────────────────────────────
# Debian-based, not alpine: sharp needs glibc.
FROM oven/bun:1.3.14 AS runtime
WORKDIR /app

# Dependencies first so a source-only change doesn't reinstall everything.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# Built frontend from stage 1. The server serves it from the same origin.
COPY --from=web /web/dist ./web/dist

# Railway injects PORT; the server reads it. This line is documentation.
EXPOSE 3177

# Volume-backed paths. Railway overrides these with the real mount.
ENV FILTRSOFT_DB=/data/filtrsoft.db
ENV FILTRSOFT_PHOTOS=/data/photos

CMD ["bun", "run", "src/api/index.ts"]

# Tests import React source too; keep those build/test dependencies out of the
# serving image while verifying the exact locked Linux installs from both stages.
FROM runtime AS verification
COPY --from=web /web/node_modules ./web/node_modules
ENV FILTRSOFT_DB=/tmp/filtrsoft-verification.db
ENV FILTRSOFT_PHOTOS=/tmp/filtrsoft-verification-photos
ENV FILTRSOFT_VISION=0
# amd64 emulation on the ARM laptop makes process-isolated fixtures slower.
# Production transport deadlines remain covered separately inside those tests.
# Railway rejects RUN --network even in an unused stage. CI applies network
# isolation at docker run, which leaves the production Dockerfile portable.
CMD ["sh", "-c", "bun test --timeout 30000 && bun run typecheck"]

FROM runtime AS production
