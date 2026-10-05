#!/usr/bin/env bash
# pnpm cluster-db:up — the realm's databases next to the cluster, like a
# cloud's managed databases: Docker containers on kind's network, outside
# Kubernetes, with their own lifecycle (they outlive cluster:down).
#
#   mmoexile-db-postgres    Postgres, TLS only, users mmoexile_migrate/_app
#   mmoexile-db-pgbouncer   PgBouncer in Postgres' network namespace
#   mmoexile-db-redis       Redis, TLS only, ACL user mmoexile
#
# Idempotent: starts what is missing, recreates a container whose
# configuration changed (e.g. after cluster:init --rotate), keeps the rest.
# The data lives in the volume mmoexile-db-postgres-data.
#
#   DB_LATENCY_MS=5 pnpm cluster-db:up   → the simulated distance (default 2)
source "$(dirname "$0")/lib.sh"

DB_LATENCY_MS=${DB_LATENCY_MS:-2}
DB_CONFIG="$K8S/databases"

[[ -s "$SECRETS/postgres-app-password" ]] || "$K8S/scripts/cluster-init.sh"

step "Docker network $DB_NETWORK"
# kind's network; kind uses it as it is when it creates a cluster later
if docker network inspect "$DB_NETWORK" >/dev/null 2>&1; then
  echo "exists"
else
  docker network create -d bridge -o com.docker.network.bridge.enable_ip_masquerade=true \
    -o com.docker.network.driver.mtu=1500 "$DB_NETWORK" >/dev/null
  echo "created"
fi

for img in "$POSTGRES_IMAGE" "$PGBOUNCER_IMAGE" "$REDIS_IMAGE"; do
  docker image inspect "$img" >/dev/null 2>&1 || docker pull -q "$img" >/dev/null
done

# Files derived from the generated passwords, mounted into the containers
umask 077
printf '"mmoexile_app" "%s"\n' "$(secret postgres-app-password)" >"$SECRETS/pgbouncer-userlist.txt"
cat >"$SECRETS/redis-users.acl" <<END
user default off
user mmoexile on >$(secret redis-password) ~* &* +@all -@admin -@dangerous +info
END

# run_db <service> <docker run args…>: (re)creates the container
# mmoexile-db-<service> if its configuration (the arguments and the content
# of every mounted file) changed, starts it if it is stopped, else keeps it.
# Prints "created", "started" or "unchanged".
run_db() {
  local name hash files current
  name=$(db_container "$1")
  shift
  files=$(printf '%s\n' "$@" | sed -n 's/^\([^:]*\):.*:ro$/\1/p')
  hash=$( { printf '%s\n' "$@"; [[ -z "$files" ]] || printf '%s\n' "$files" | xargs -d '\n' cat; } | sha256sum | cut -c1-16)
  current=$(docker inspect -f '{{index .Config.Labels "mmoexile.dev/config"}} {{.State.Running}}' "$name" 2>/dev/null || true)
  if [[ "$current" == "$hash true" ]]; then
    echo unchanged
  elif [[ "$current" == "$hash false" ]]; then
    docker start "$name" >/dev/null
    echo started
  else
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker run -d --name "$name" --label "mmoexile.dev/config=$hash" --label mmoexile.dev/database=true \
      --restart unless-stopped ${DB_RUN_EXTRA:-} "$@" >/dev/null
    echo created
  fi
}

# Copies the mounted certificate, key and files to /tls, owned by the
# server's user (the originals belong to you and are readable only by you),
# then starts the server as that user.
install_tls() { echo "install -d -o $1 -g $1 -m 700 /tls && install -o $1 -g $1 -m 600 /secrets/* /tls/"; }

step "Postgres $POSTGRES_IMAGE"
# The superuser can only log in from inside the container (pg_hba.conf);
# its password is never used, so a random one each time.
postgres=$(DB_RUN_EXTRA="-e POSTGRES_PASSWORD=$(openssl rand -hex 16)" run_db postgres \
  --network "$DB_NETWORK" \
  -v mmoexile-db-postgres-data:/var/lib/postgresql/data \
  -v "$SECRETS/postgres.crt:/secrets/server.crt:ro" \
  -v "$SECRETS/postgres.key:/secrets/server.key:ro" \
  -v "$SECRETS/ca.crt:/secrets/ca.crt:ro" \
  -v "$DB_CONFIG/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro" \
  --entrypoint sh "$POSTGRES_IMAGE" -c "$(install_tls postgres) && exec docker-entrypoint.sh postgres \
    -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key \
    -c ssl_min_protocol_version=TLSv1.2 -c password_encryption=scram-sha-256 \
    -c hba_file=/etc/postgresql/pg_hba.conf -c max_connections=100")
echo "$postgres"
# Ready on TCP (the first start's temporary server only listens on a socket)
for _ in $(seq 60); do
  docker exec "$(db_container postgres)" pg_isready -q -h localhost && break
  sleep 1
done
docker exec "$(db_container postgres)" pg_isready -h localhost || fail "Postgres not ready (docker logs $(db_container postgres))"
# Users and privileges, with the current passwords (stdin: not in any
# process' arguments)
{
  printf '\\set migrate_password %s\n\\set app_password %s\n' "$(secret postgres-migrate-password)" "$(secret postgres-app-password)"
  cat "$DB_CONFIG/setup.sql"
} | docker exec -i "$(db_container postgres)" psql -q -U postgres -v ON_ERROR_STOP=1 -f - >/dev/null
echo "users mmoexile_migrate, mmoexile_app"

step "PgBouncer $PGBOUNCER_IMAGE"
# In Postgres' network namespace: recreated whenever Postgres is
[[ "$postgres" == unchanged ]] || docker rm -f "$(db_container pgbouncer)" >/dev/null 2>&1 || true
run_db pgbouncer \
  --network "container:$(db_container postgres)" \
  -v "$DB_CONFIG/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro" \
  -v "$SECRETS/pgbouncer.crt:/secrets/server.crt:ro" \
  -v "$SECRETS/pgbouncer.key:/secrets/server.key:ro" \
  -v "$SECRETS/ca.crt:/secrets/ca.crt:ro" \
  -v "$SECRETS/pgbouncer-userlist.txt:/secrets/userlist.txt:ro" \
  --user 0 --entrypoint sh "$PGBOUNCER_IMAGE" -c "$(install_tls postgres) && \
    exec su -s /bin/sh postgres -c 'exec pgbouncer /etc/pgbouncer/pgbouncer.ini'"

step "Redis $REDIS_IMAGE"
run_db redis \
  --network "$DB_NETWORK" \
  -v "$DB_CONFIG/redis.conf:/usr/local/etc/redis/redis.conf:ro" \
  -v "$SECRETS/redis.crt:/secrets/server.crt:ro" \
  -v "$SECRETS/redis.key:/secrets/server.key:ro" \
  -v "$SECRETS/ca.crt:/secrets/ca.crt:ro" \
  -v "$SECRETS/redis-users.acl:/secrets/users.acl:ro" \
  --entrypoint sh "$REDIS_IMAGE" -c "$(install_tls redis) && exec docker-entrypoint.sh redis-server /usr/local/etc/redis/redis.conf"

step "Simulated distance: +${DB_LATENCY_MS} ms"
# What the database containers send is delayed (tc netem in their network
# namespace, from a short-lived container): every round trip to a database
# takes DB_LATENCY_MS longer, like a database in another availability zone.
# PgBouncer shares Postgres' namespace and reaches it on localhost, undelayed.
docker build -q -f "$ROOT/infra/docker/netem.Dockerfile" -t "$(image netem)" "$ROOT/infra/docker" >/dev/null
for service in postgres redis; do
  docker run --rm --network "container:$(db_container "$service")" --cap-add NET_ADMIN --entrypoint tc "$(image netem)" \
    qdisc replace dev eth0 root netem delay "${DB_LATENCY_MS}ms"
done

step "Checks"
for _ in $(seq 30); do
  db_ready && break
  sleep 1
done
db_ready || fail "Databases not ready (docker logs $(db_container pgbouncer) / $(db_container redis))"
echo "Postgres, PgBouncer (as mmoexile_app, TLS) and Redis (as mmoexile, TLS) answer"
for service in postgres redis; do
  echo "$(db_container "$service"): $(db_address "$service")"
done
