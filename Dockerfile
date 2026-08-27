# syntax=docker/dockerfile:1
#
# Production image for MiGallery (SvelteKit served by bun).
#
# bun is BOTH the package manager and the runtime. It used to be the package
# manager only, node being the runtime, for two measured reasons. Both were
# re-measured on bun 1.4.0 and neither survives:
#   - "bun inflates every request-body read ~80x and retains it, so upload
#     bursts OOM the box" is GONE. 50 bodies totalling 2.2 GB: bun peaks at
#     211 MB RSS against node's 248 MB, and bun's RSS DROPS between passes.
#   - "better-sqlite3, a V8-ABI addon, segfaults bun outright" is still TRUE
#     (reproduced on bun 1.4.0 on this host's own kernel, linux x64 glibc
#     2.41). It no longer applies because better-sqlite3 is GONE: the app uses
#     `bun:sqlite`, the runtime's own driver. See src/lib/db/database.ts.
# `sharp`, the other native dependency, runs clean on both.
#
# Debian (glibc) base, not alpine: sharp's prebuilt binaries are glibc, and the
# lockfile carries @img/sharp-linux-x64 rather than the linuxmusl variant.
#
# No python3/make/g++ either. They were here because bun, like npm, defaults a
# package shipping a `binding.gyp` with no install script to `node-gyp rebuild`,
# and better-sqlite3 then compiled from source. Nothing in the tree compiles now.

# Must match .bun-version, which is what CI and every contributor's toolchain read.
ARG BUN_VERSION=1.4.0

# -- Build ----------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
# Skip husky (git hooks) during install; there is no .git in the build context.
ENV HUSKY=0
# Cache deps: copy manifests first. `--frozen-lockfile` is the point of committing
# bun.lock - a resolution that drifts from the one CI gated must fail the build,
# not be silently repaired here.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# -- Runtime --------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS runtime
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
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "./build/index.js"]
