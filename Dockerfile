# syntax=docker/dockerfile:1
#
# Image de production MiGallery (SvelteKit servi par Bun).
# Base debian (glibc) car les dependances natives (better-sqlite3, sharp,
# ffmpeg-static/ffprobe-static) ne fonctionnent pas sur la base alpine/musl.

# ── Build ─────────────────────────────────────────────────────────────────────
FROM oven/bun:1-debian AS build
WORKDIR /app
# Outils de compilation pour les modules natifs (better-sqlite3 via node-gyp).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Cache des deps : on copie d abord les manifestes.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM oven/bun:1-debian AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# On reutilise node_modules du stage build (natifs deja compiles) plutot qu un
# reinstall --production : evite que bun saute les postinstall (trustedDependencies)
# et garantit des binaires natifs identiques a ceux testes au build.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/build ./build
# Fichiers lus a l execution (hors build/) : schema SQL, scripts admin, docs.
COPY --from=build /app/src/lib/db/schema.sql ./src/lib/db/schema.sql
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/docs ./docs

# data/ (base SQLite + caches) est monte en volume, persiste hors image.
RUN mkdir -p data
VOLUME ["/app/data"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "./build/index.js"]
