#!/usr/bin/env sh
set -eu

CACHE_DIR="/import_cache"
OUTPUT_PATH="${CACHE_DIR}/region.osm.pbf"
STAMP_PATH="${CACHE_DIR}/region.osm.pbf.source-url"

mkdir -p "${CACHE_DIR}"

if [ -z "${region_url:-}" ]; then
  echo "ERROR: region_url is not set." >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

if [ -f "${OUTPUT_PATH}" ] && [ -f "${STAMP_PATH}" ] && [ "$(cat "${STAMP_PATH}")" = "${region_url}" ]; then
  echo "INFO: Extract already downloaded for ${region_url}, reusing ${OUTPUT_PATH}."
else
  echo "INFO: Downloading ${region_url}"
  curl --location --fail --show-error -o "${OUTPUT_PATH}.tmp" "${region_url}"
  mv "${OUTPUT_PATH}.tmp" "${OUTPUT_PATH}"
  echo "${region_url}" > "${STAMP_PATH}"
fi

echo "INFO: Creating osm_import staging schema (if needed)"
psql "${DATABASE_URL}" -c "create schema if not exists osm_import;"

echo "INFO: Dropping any previous staging tables so this run starts clean"
psql "${DATABASE_URL}" -c "drop schema osm_import cascade; create schema osm_import;"

echo "INFO: Running osm2pgsql flex import against ${OUTPUT_PATH}"
osm2pgsql \
  --slim \
  --drop \
  --output=flex \
  --style=/style.lua \
  -d "${DATABASE_URL}" \
  "${OUTPUT_PATH}"

echo "INFO: osm2pgsql import done. Staging tables are in the osm_import schema."
echo "INFO: Next step: pnpm --filter api import:power-grid"
