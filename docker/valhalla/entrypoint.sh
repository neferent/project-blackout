#!/usr/bin/env sh
set -eu

CUSTOM_FILES="/custom_files"
OUTPUT_PATH="${CUSTOM_FILES}/region.osm.pbf"
STAMP_PATH="${CUSTOM_FILES}/region.osm.pbf.source-url"

mkdir -p "${CUSTOM_FILES}"

if [ -z "${tile_url:-}" ]; then
  echo "ERROR: tile_url is not set." >&2
  exit 1
fi

if [ -f "${OUTPUT_PATH}" ] && [ -f "${STAMP_PATH}" ] && [ "$(cat "${STAMP_PATH}")" = "${tile_url}" ]; then
  echo "INFO: Patched extract already exists for ${tile_url}, skipping re-download/patch."
  exit 0
fi

RAW_PATH="/tmp/source.osm.pbf"
echo "INFO: Downloading ${tile_url}"
curl --location --fail --show-error -o "${RAW_PATH}" "${tile_url}"

echo "INFO: Patching foot access onto bike-accessible ways"
TMP_OUTPUT_PATH="/tmp/region.osm.pbf"
python3 /patch_foot_access.py "${RAW_PATH}" "${TMP_OUTPUT_PATH}"
mv "${TMP_OUTPUT_PATH}" "${OUTPUT_PATH}"
echo "${tile_url}" > "${STAMP_PATH}"

rm -f "${RAW_PATH}"
echo "INFO: Done. Wrote ${OUTPUT_PATH}"
