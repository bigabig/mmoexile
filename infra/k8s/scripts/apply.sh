#!/usr/bin/env bash
# Applies the realm's manifests (overlays/central, overlays/eu,
# overlays/us) to their clusters and waits until it runs. Called by
# cluster-up.sh; can be run alone after editing manifests.
source "$(dirname "$0")/lib.sh"

step "Manifests"
[[ -s "$SECRETS/session-secret" ]] || fail "No secrets in $SECRETS (pnpm cluster:init)"
db_ready || fail "The databases don't answer (pnpm cluster-db:up)"
# The connection URLs with the generated passwords. Prisma verifies the
# server's certificate (CA and host name) only with sslaccept=strict;
# sslcert is the CA to verify against. The regions get only the services'
# users, not the migration user.
ca=/etc/mmoexile/database-ca/ca.crt
tls="sslmode=require&sslcert=$ca&sslaccept=strict"
cat >"$SECRETS/connections-region.env" <<END
DATABASE_URL=postgresql://mmoexile_app:$(secret postgres-app-password)@pgbouncer:6432/mmoexile?$tls
REDIS_URL=rediss://mmoexile:$(secret redis-password)@redis:6380
END
{
  cat "$SECRETS/connections-region.env"
  echo "MIGRATE_DATABASE_URL=postgresql://mmoexile_migrate:$(secret postgres-migrate-password)@postgres:5432/mmoexile?$tls"
} >"$SECRETS/connections-central.env"
chmod 600 "$SECRETS"/connections-*.env
rm -f "$SECRETS/connections.env"  # Stage 6: one cluster, one file

# The bases share files with compose (nginx config, Grafana dashboard)
# outside their directories, which kustomize only reads when allowed to.
rendered=$(mktemp -d)
trap 'rm -rf "$rendered"' EXIT
for cluster in "${CLUSTERS[@]}"; do
  kubectl kustomize --load-restrictor LoadRestrictionsNone "$K8S/overlays/$cluster" >"$rendered/$cluster.yaml"
done

# 1. Central: configuration, the databases' Services and addresses, the
#    migration. A Job can't be changed once created, so the previous run
#    is deleted first.
kc central -n "$NAMESPACE" delete job migrate --ignore-not-found >/dev/null
kc central apply -f "$rendered/central.yaml" -l 'app.kubernetes.io/component in (config,data)'
apply_db_endpoints central
kc central -n "$NAMESPACE" wait --for=condition=complete job/migrate --timeout=300s

# 2. Everything else, in every cluster
apply_cluster() {
  local cluster=$1
  if [[ "$cluster" != central ]]; then
    kc "$cluster" apply -f "$rendered/$cluster.yaml" -l 'app.kubernetes.io/component in (config,data)' >/dev/null
    apply_db_endpoints "$cluster"
  fi
  kc "$cluster" apply -f "$rendered/$cluster.yaml"
  for deployment in $(kc "$cluster" -n "$NAMESPACE" get deployments -o name); do
    kc "$cluster" -n "$NAMESPACE" rollout status "$deployment" --timeout=300s
  done
  # Instance servers: every GameServer of each Fleet Ready or Allocated
  for fleet in $(kc "$cluster" -n "$NAMESPACE" get fleets -o name 2>/dev/null); do
    local status want ready allocated
    for _ in $(seq 120); do
      status=$(kc "$cluster" -n "$NAMESPACE" get "$fleet" -o jsonpath='{.spec.replicas} {.status.readyReplicas} {.status.allocatedReplicas}')
      read -r want ready allocated <<<"$status"
      (( ${ready:-0} + ${allocated:-0} >= want && want > 0 )) && break
      sleep 2
    done
    echo "$fleet: ${ready:-0} ready, ${allocated:-0} allocated (of $want)"
    (( ${ready:-0} + ${allocated:-0} >= want )) || { echo "$fleet not ready" >&2; return 1; }
  done
}
for_clusters apply_cluster "${CLUSTERS[@]}"
