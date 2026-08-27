# syntax=docker/dockerfile:1
#
# Production image for MiGallery (SvelteKit served by Node).
#
# Bun is the PACKAGE MANAGER, Node is the RUNTIME, and that split is measured,
# not stylistic:
#   - Bun as a runtime inflates every incoming request-body read ~80x and retains
#     it under mimalloc (neither Bun.gc nor glibc malloc_trim reclaim it), so
#     upload bursts OOM the box. Node reads bodies normally and returns freed
#     memory to glibc.
#   - `better-sqlite3` is a V8-ABI addon and SEGFAULTS the bun runtime outright
#     (measured on bun 1.4.0); under Node it loads fine from the node_modules bun
#     installed, because bun install resolves the same tree npm did.
# So `bun install` here, `node build/index.js` at the end, and no runtime bun.
#
# Debian (glibc) base: native deps (better-sqlite3, sharp) do not work on
# alpine/musl.

# Must match .bun-version, which is what CI and every contributor's toolchain read.
ARG BUN_VERSION=1.4.0

# -- Build ----------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS bun
FROM node:24-bookworm-slim AS build
WORKDIR /app
# Skip husky (git hooks) during install; there is no .git in the build context.
ENV HUSKY=0
# Build tools for native modules. They are NOT vestigial and removing them was
# tried: bun, like npm, defaults a package that ships a `binding.gyp` and declares
# no install script to `node-gyp rebuild`, so better-sqlite3 compiles from source
# and the build dies on "Could not find any Python installation to use".
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Bun installs; Node stays the runtime, so only the binary is borrowed.
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
# Cache deps: copy manifests first. `--frozen-lockfile` is the point of committing
# bun.lock - a resolution that drifts from the one CI gated must fail the build,
# not be silently repaired here.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# -- Runtime --------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Reuse node_modules from the build stage (native binaries already resolved).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/build ./build
# Files read at runtime (outside build/): SQL schema, admin scripts, docs.
COPY --from=build /app/src/lib/db/schema.sql ./src/lib/db/schema.sql
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/docs ./docs

# data/ (SQLite db + caches) is a mounted volume, persists outside the image.
RUN mkdir -p data
VOLUME ["/app/data"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "./build/index.js"]
