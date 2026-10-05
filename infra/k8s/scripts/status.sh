#!/usr/bin/env bash
# pnpm cluster:status — what runs where: the clusters and their pods, the
# fleets and their GameServers, and the fleet as the orchestrator sees it.
source "$(dirname "$0")/lib.sh"
require_clusters

step "Clusters"
for cluster in "${CLUSTERS[@]}"; do
  kc "$cluster" get nodes --no-headers -o custom-columns="NAME:.metadata.name,VERSION:.status.nodeInfo.kubeletVersion,IP:.status.addresses[0].address"
done
kc central get svc -A --field-selector spec.type=LoadBalancer -o wide 2>/dev/null | tail -n +2 | sed 's/^/central /' || true
for cluster in "${REGIONS[@]}"; do
  kc "$cluster" get svc -A --field-selector spec.type=LoadBalancer -o wide 2>/dev/null | tail -n +2 | sed "s/^/$cluster /" || true
done

for cluster in "${CLUSTERS[@]}"; do
  step "Pods in $cluster ($NAMESPACE)"
  kc "$cluster" -n "$NAMESPACE" get pods -o wide
done

for cluster in "${REGIONS[@]}"; do
  step "Fleet, autoscaler and GameServers in $cluster"
  kc "$cluster" -n "$NAMESPACE" get fleets,fleetautoscalers
  kc "$cluster" -n "$NAMESPACE" get gameservers \
    -o custom-columns='NAME:.metadata.name,STATE:.status.state,PORT:.status.ports[0].port,PLAYERS:.status.counters.players.count,CAPACITY:.status.counters.players.capacity'
done

step "Orchestrator (localhost:3013/servers)"
curl -fsS http://localhost:3013/servers | node -e '
  let input = "";
  process.stdin.on("data", (d) => (input += d)).on("end", () => {
    for (const s of JSON.parse(input).servers) {
      console.log(`${s.serverId.padEnd(34)} ${s.region.padEnd(4)} ${s.state.padEnd(9)} ${String(s.players).padStart(4)} players  ${s.url}`);
    }
  });' || echo "orchestrator not reachable"
