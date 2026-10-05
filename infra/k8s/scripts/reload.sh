#!/usr/bin/env bash
# pnpm cluster:reload <app> — rebuild one image, load it into the cluster
# and roll it out (the dev loop after changing code).
#
#   pnpm cluster:reload account-api      # Deployments: rolling restart
#   pnpm cluster:reload instance-server  # Fleets: rolling update + drain
#
# Instance servers: Agones replaces Ready (empty) GameServers of the old
# version itself, but never Allocated ones, and ours stay Allocated as long
# as players are on them. It also counts the old Allocated servers toward
# the Fleet's size, so while all of them are in use no new server starts.
# Hence, per Fleet:
#   1. make room for one more server (the FleetAutoscaler's minimum + 1),
#      which Agones starts in the new version;
#   2. drain the old servers through the orchestrator one at a time: the
#      players move to other servers without a kick, the server shuts down,
#      Agones starts its replacement in the new version;
#   3. put the minimum back (also if anything fails).
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

# set_limits <fleet> <minCapacity> <maxCapacity>: the FleetAutoscaler's bounds
set_limits() {
  k -n "$NAMESPACE" patch fleetautoscaler "$1" --type json -p \
    "[{\"op\":\"replace\",\"path\":\"/spec/policy/counter/minCapacity\",\"value\":$2},{\"op\":\"replace\",\"path\":\"/spec/policy/counter/maxCapacity\",\"value\":$3}]" >/dev/null
}
# The usual bounds of every Fleet being rolled ("name min max"), put back on exit
usual_limits=()
restore_limits() {
  for entry in "${usual_limits[@]}"; do set_limits $entry; done
}
trap restore_limits EXIT

for fleet in $(k -n "$NAMESPACE" get fleets -o name); do
  name=${fleet#*/}
  step "Roll $fleet"

  # 1. Room for one more server while the old ones are still in use
  read -r min max <<<"$(k -n "$NAMESPACE" get fleetautoscaler "$name" -o jsonpath='{.spec.policy.counter.minCapacity} {.spec.policy.counter.maxCapacity}')"
  capacity=$(k -n "$NAMESPACE" get fleet "$name" -o jsonpath='{.spec.template.spec.counters.players.capacity}')
  usual_limits+=("$name $min $max")
  set_limits "$name" $((min + capacity)) $((max + capacity))
  echo "autoscaler: room for one more server during the rollout"

  # Any change to the template starts a rolling update (a new GameServerSet)
  k -n "$NAMESPACE" patch "$fleet" --type merge \
    -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"mmoexile.dev/reloaded-at\":\"$stamp\"}}}}}" >/dev/null

  new_set=""
  new_ready() {
    new_set=$(k -n "$NAMESPACE" get gameserversets -l "agones.dev/fleet=$name" \
      -o jsonpath="{range .items[?(@.spec.template.metadata.annotations.mmoexile\.dev/reloaded-at==\"$stamp\")]}{.metadata.name}{end}")
    [[ -n "$new_set" ]] || return 1
    local ready
    ready=$(k -n "$NAMESPACE" get gameserverset "$new_set" -o jsonpath='{.status.readyReplicas}')
    (( ${ready:-0} > 0 ))
  }
  fleet_complete() {  # every GameServer the Fleet wants is Ready or Allocated
    local want ready allocated
    read -r want ready allocated <<<"$(k -n "$NAMESPACE" get fleet "$name" -o jsonpath='{.spec.replicas} {.status.readyReplicas} {.status.allocatedReplicas}')"
    (( ${ready:-0} + ${allocated:-0} >= want ))
  }
  old_servers() {
    k -n "$NAMESPACE" get gameservers -l "agones.dev/fleet=$name" \
      -o jsonpath="{range .items[?(@.metadata.labels.agones\.dev/gameserverset!=\"$new_set\")]}{.metadata.name} {end}"
  }
  wait_until() {  # wait_until <seconds> <description> <command...>
    local seconds=$1 what=$2
    shift 2
    for _ in $(seq $((seconds / 2))); do "$@" && return 0; sleep 2; done
    fail "timed out waiting for: $what"
  }
  wait_until 180 "a server of the new version" new_ready
  echo "new version $new_set is up"

  # 2. Drain the old servers one at a time; each is replaced by a new one
  for server in $(old_servers); do
    echo "drain $server"
    curl -fsS -X POST "$ORCHESTRATOR/servers/$server/drain" >/dev/null || echo "  (not known to the orchestrator)"
    gone() { ! k -n "$NAMESPACE" get gameserver "$server" >/dev/null 2>&1; }
    wait_until 240 "$server to drain and stop" gone
    wait_until 180 "its replacement" fleet_complete
  done
  [[ -z "$(old_servers)" ]] || fail "old servers still running: $(old_servers)"
  echo "old version gone"

  # 3. Back to the usual bounds
  set_limits "$name" "$min" "$max"
  usual_limits=("${usual_limits[@]:0:${#usual_limits[@]}-1}")
done
