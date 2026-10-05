#!/usr/bin/env bash
# pnpm cluster-db:psql — psql in the Postgres container as the migration
# user (owns the schema), over TLS like everyone else. Arguments go to psql:
#
#   pnpm cluster-db:psql
#   pnpm cluster-db:psql -- -c 'select count(*) from "Character"'
source "$(dirname "$0")/lib.sh"
[[ "${1:-}" == -- ]] && shift  # pnpm passes "--" on

tty=()
[[ -t 0 && -t 1 ]] && tty=(-t)
PGPASSWORD=$(secret postgres-migrate-password) exec docker exec -i "${tty[@]}" -e PGPASSWORD "$(db_container postgres)" \
  psql "host=localhost dbname=mmoexile user=mmoexile_migrate sslmode=verify-full sslrootcert=/tls/ca.crt" "$@"
