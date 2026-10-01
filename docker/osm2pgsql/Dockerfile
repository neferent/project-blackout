FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends osm2pgsql curl postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY style.lua /style.lua
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
