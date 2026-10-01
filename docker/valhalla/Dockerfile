FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libexpat1 libbz2-1.0 zlib1g \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir osmium

COPY patch_foot_access.py /patch_foot_access.py
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
