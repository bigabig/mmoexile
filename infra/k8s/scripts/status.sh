#!/usr/bin/env bash
# pnpm cluster:status — what runs where: nodes, pods, fleets and their
# GameServers, and the fleet as the orchestrator sees it.
source "$(dirname "$0")/lib.sh"
cluster_exists || fail "No cluster $CLUSTER (pnpm cluster:up)"

step "Nodes"
k get nodes -L mmoexile.dev/role,mmoexile.dev/region

step "Pods ($NAMESPACE)"
k -n "$NAMESPACE" get pods -o wide

step "Fleets and autoscalers"
k -n "$NAMESPACE" get fleets
k -n "$NAMESPACE" get fleetautoscalers

step "GameServers"
k -n "$NAMESPACE" get gameservers \
  -o custom-columns='NAME:.metadata.name,STATE:.status.state,PORT:.status.ports[0].port,PLAYERS:.status.counters.players.count,CAPACITY:.status.counters.players.capacity,NODE:.status.nodeName'

step "Orchestrator (localhost:3013/servers)"
curl -fsS http://localhost:3013/servers | node -e '
  let input = "";
  process.stdin.on("data", (d) => (input += d)).on("end", () => {
    for (const s of JSON.parse(input).servers) {
      console.log(`${s.serverId.padEnd(34)} ${s.region.padEnd(4)} ${s.state.padEnd(9)} ${String(s.players).padStart(4)} players  ${s.url}`);
    }
  });' || echo "orchestrator not reachable"
