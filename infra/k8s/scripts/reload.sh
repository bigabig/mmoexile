#!/usr/bin/env bash
# pnpm cluster:reload <app> — rebuild one image, load it into the cluster
# and roll it out (the dev loop after changing code).
#
#   pnpm cluster:reload account-api      # Deployments: rolling restart
#   pnpm cluster:reload instance-server  # Fleets: rolling update + drain
#
# Instance servers: Agones replaces Ready (empty) GameServers of the old
# version right away, but never Allocated ones, and ours stay Allocated as
# long as players are on them. So once the new version is up, the old
# servers are drained through the orchestrator: their players move to
# other servers without a kick, then the servers shut down.
source "$(dirname "$0")/lib.sh"

app=${1:-}
case "$app" in
  account-api|social|orchestrator|directory|client|instance-server) ;;
  *) fail "Usage: pnpm cluster:reload <account-api|social|orchestrator|directory|client|instance-server>" ;;
esac
cluster_exists || fail "No cluster $CLUSTER (pnpm cluster:up)"

step "Build and load $(image "$app")"
build_image "$app"
if [[ "$app" == instance-server ]]; then
  load_images mmoexile.dev/region "$(image "$app")"
else
  load_images mmoexile.dev/role=central "$(image "$app")"
fi

if [[ "$app" != instance-server ]]; then
  step "Rolling restart"
  k -n "$NAMESPACE" rollout restart "deployment/$app"
  k -n "$NAMESPACE" rollout status "deployment/$app" --timeout=300s
  exit 0
fi

ORCHESTRATOR=http://localhost:3013
stamp=$(date +%s)
for fleet in $(k -n "$NAMESPACE" get fleets -o name); do
  step "Roll $fleet"
  # Any change to the template starts a rolling update (a new GameServerSet)
  k -n "$NAMESPACE" patch "$fleet" --type merge \
    -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"mmoexile.dev/reloaded-at\":\"$stamp\"}}}}}"
  name=${fleet#*/}

  # Wait until Agones did what it does alone: the new version (a
  # GameServerSet with this stamp) has a server ready, and every old server
  # left is Allocated (in use)
  old_servers() {
    k -n "$NAMESPACE" get gameservers -l "agones.dev/fleet=$name" \
      -o jsonpath="{range .items[?(@.metadata.labels.agones\.dev/gameserverset!=\"$new_set\")]}{.metadata.name}={.status.state} {end}"
  }
  for _ in $(seq 150); do
    new_set=$(k -n "$NAMESPACE" get gameserversets -l "agones.dev/fleet=$name" \
      -o jsonpath="{range .items[?(@.spec.template.metadata.annotations.mmoexile\.dev/reloaded-at==\"$stamp\")]}{.metadata.name}{end}")
    if [[ -n "$new_set" ]]; then
      ready=$(k -n "$NAMESPACE" get gameserverset "$new_set" -o jsonpath='{.status.readyReplicas}')
      (( ${ready:-0} > 0 )) && [[ "$(old_servers)" != *=Ready* ]] && break
    fi
    sleep 2
  done
  echo "new version $new_set has ${ready:-0} ready; old servers in use: $(old_servers)"

  # Drain the old version's servers that are still in use
  old=$(old_servers | sed 's/=[A-Za-z]*//g')
  for server in $old; do
    echo "drain $server"
    curl -fsS -X POST "$ORCHESTRATOR/servers/$server/drain" >/dev/null || echo "  (not known to the orchestrator)"
  done
  for _ in $(seq 120); do
    left=$(old_servers)
    [[ -z "$left" ]] && break
    sleep 2
  done
  [[ -z "$left" ]] || fail "old servers still running: $left"
  echo "old version gone"
done
