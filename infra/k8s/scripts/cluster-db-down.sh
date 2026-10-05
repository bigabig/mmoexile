#!/usr/bin/env bash
# pnpm cluster-db:down — stops and removes the database containers. The data
# (volume mmoexile-db-postgres-data) and the secrets (.secrets/) stay, so
# cluster-db:up continues where it left off.
#
#   pnpm cluster-db:down -- --wipe   also deletes the data and the secrets
source "$(dirname "$0")/lib.sh"
[[ "${1:-}" == -- ]] && shift  # pnpm passes "--" on

wipe=false
case "${1:-}" in
  "") ;;
  --wipe) wipe=true ;;
  *) fail "Usage: pnpm cluster-db:down [-- --wipe]" ;;
esac

# PgBouncer first: it lives in Postgres' network namespace
for service in pgbouncer postgres redis; do
  docker rm -f "$(db_container "$service")" >/dev/null 2>&1 && echo "Removed $(db_container "$service")" || true
done

if $wipe; then
  docker volume rm mmoexile-db-postgres-data >/dev/null 2>&1 && echo "Removed volume mmoexile-db-postgres-data" || true
  rm -rf "$SECRETS" && echo "Removed $SECRETS"
fi

remove_unused_network
