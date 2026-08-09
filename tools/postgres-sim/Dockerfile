FROM postgres@sha256:9b18b78397054fce88a9552e9d5a3ad5bb7fd258c5b3cc1c5028e46373d6ea8f

ARG H3_PG_COMMIT=a26630b8353d441e6bc8065c0a8dcaa3d89ef87b
ARG H3_PG_SHA256=b46d6d7bd1ae59f35382de4eaa810be2fafcb1a337cc4869dacd0b51c38b66ce

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      cmake \
      curl \
      postgresql-17-postgis-3 \
      postgresql-17-postgis-3-scripts \
      postgresql-server-dev-17; \
    curl -LfsS \
      "https://github.com/postgis/h3-pg/archive/${H3_PG_COMMIT}.tar.gz" \
      -o /tmp/h3-pg.tar.gz; \
    echo "${H3_PG_SHA256}  /tmp/h3-pg.tar.gz" | sha256sum -c -; \
    mkdir /tmp/h3-pg; \
    tar -xzf /tmp/h3-pg.tar.gz -C /tmp/h3-pg --strip-components=1; \
    cmake -S /tmp/h3-pg -B /tmp/h3-pg/build \
      -DCMAKE_BUILD_TYPE=Release \
      -DPostgreSQL_INDENT=PostgreSQL_INDENT-NOTFOUND; \
    cmake --build /tmp/h3-pg/build --parallel 1; \
    cmake --install /tmp/h3-pg/build --component h3-pg; \
    apt-get purge -y --auto-remove \
      build-essential \
      cmake \
      curl \
      postgresql-server-dev-17; \
    rm -rf /var/lib/apt/lists/* /tmp/h3-pg /tmp/h3-pg.tar.gz; \
    test -f /usr/share/postgresql/17/extension/h3.control; \
    test -f /usr/share/postgresql/17/extension/h3_postgis.control
