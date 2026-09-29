# Beefcake platform on Fly.io: one machine, one SQLite file on a volume.
#
# The image keeps `tsx` and `src/` so the facilitator can reseed the hosted
# database in place with `npm run db:reset -- --today <date>` (see
# beefcake-workshop/workshop/setup/deploy-platform.sh). The seed is
# deterministic, so a reseed on the machine matches the local one the corpus
# was exported from, and nothing 450 MB has to be uploaded.

FROM node:24-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 falls back to compiling when no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# Runtime needs production dependencies plus tsx (a dependency, for the reseed).
RUN npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1 \
    BEEFCAKE_DB=/data/beefcake.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json package-lock.json next.config.mjs tsconfig.json ./
COPY src ./src
RUN mkdir -p /data
EXPOSE 3000
CMD ["npm", "run", "start"]
