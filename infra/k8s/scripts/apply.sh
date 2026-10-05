#!/usr/bin/env bash
# Applies the realm's manifests (overlays/kind) and waits until it runs.
# Called by cluster-up.sh; can be run alone after editing manifests.
source "$(dirname "$0")/lib.sh"

step "Manifests"
# The base shares files with compose (nginx config, Grafana dashboard)
# outside its directory, which kustomize only reads when allowed to.
rendered=$(mktemp)
trap 'rm -f "$rendered"' EXIT
kubectl kustomize --load-restrictor LoadRestrictionsNone "$K8S/overlays/kind" >"$rendered"

# 1. Configuration, Postgres, Redis and the migration. A Job can't be
#    changed once created, so the previous run is deleted first.
k -n "$NAMESPACE" delete job migrate --ignore-not-found >/dev/null
k apply -f "$rendered" -l 'app.kubernetes.io/component in (config,data)'
k -n "$NAMESPACE" rollout status statefulset/postgres --timeout=180s
k -n "$NAMESPACE" rollout status deployment/redis --timeout=180s
k -n "$NAMESPACE" wait --for=condition=complete job/migrate --timeout=300s

# 2. Everything else
k apply -f "$rendered"
for deployment in $(k -n "$NAMESPACE" get deployments -o name); do
  k -n "$NAMESPACE" rollout status "$deployment" --timeout=300s
done

# 3. Instance servers: every GameServer of each Fleet Ready or Allocated
for fleet in $(k -n "$NAMESPACE" get fleets -o name); do
  for _ in $(seq 120); do
    status=$(k -n "$NAMESPACE" get "$fleet" -o jsonpath='{.spec.replicas} {.status.readyReplicas} {.status.allocatedReplicas}')
    read -r want ready allocated <<<"$status"
    (( ${ready:-0} + ${allocated:-0} >= want && want > 0 )) && break
    sleep 2
  done
  echo "$fleet: ${ready:-0} ready, ${allocated:-0} allocated (of $want)"
  (( ${ready:-0} + ${allocated:-0} >= want )) || fail "$fleet not ready"
done
