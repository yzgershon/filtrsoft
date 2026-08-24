# Explicit Bun image instead of letting Nixpacks guess.
#
# Nixpacks detects Bun by looking for `bun.lockb`. This repo has the newer text
# `bun.lock`, so Nixpacks fell back to Node and the build died on `bun: not found`.
# A Dockerfile removes the guessing entirely.
#
# Debian-based (not alpine) on purpose: sharp needs glibc, and the alpine variant
# needs extra native deps to build it from source.
FROM oven/bun:1

WORKDIR /app

# Dependencies first so a source-only change doesn't reinstall everything.
COPY package.json bun.lock ./
COPY web/package.json ./web/
RUN bun install --frozen-lockfile || bun install

# Source
COPY . .

# Build the frontend. The server serves web/dist from the same origin.
RUN cd web && bun install && bun run build

# Railway injects PORT; the server reads it. This is documentation, not a bind.
EXPOSE 3177

# Volume-backed paths. Railway overrides these with the real mount.
ENV ASSYZE_DB=/data/assyze.db
ENV ASSYZE_PHOTOS=/data/photos

CMD ["bun", "run", "src/api/index.ts"]
