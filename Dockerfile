# syntax=docker/dockerfile:1
#
# Production image for MiGallery (SvelteKit served by Node).
#
# Runtime is Node, NOT Bun: Bun inflates every incoming request-body read ~80x
# and retains it under mimalloc (neither Bun.gc nor glibc malloc_trim reclaim
# it), so upload bursts OOM the box. Node reads bodies normally and returns
# freed memory to glibc. Both stages use the SAME Node image so the native
# addons (better-sqlite3 is a V8-ABI addon) are compiled against the runtime.
#
# Debian (glibc) base: native deps (better-sqlite3, sharp) do not work on
# alpine/musl.

# -- Build ----------------------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app
# Skip husky (git hooks) during install; there is no .git in the build context.
ENV HUSKY=0
# Build tools for native modules (better-sqlite3 via node-gyp).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Cache deps: copy manifests first.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# -- Runtime --------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Reuse node_modules from the build stage (native binaries already compiled).
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
