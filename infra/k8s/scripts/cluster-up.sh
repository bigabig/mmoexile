#!/usr/bin/env bash
# pnpm cluster:up — the realm on a local Kubernetes cluster with Agones.
# Idempotent: creates what is missing, updates the rest, and can be re-run
# at any time (e.g. after changing manifests or code).
#
#   US_LATENCY_MS=120 pnpm cluster:up   → the simulated distance to the us node
source "$(dirname "$0")/lib.sh"

US_LATENCY_MS=${US_LATENCY_MS:-40}

step "Tools"
for tool in docker kind kubectl helm; do
  command -v "$tool" >/dev/null || fail "$tool not found (see docs/DEVELOPMENT_SETUP.md)"
done
echo "kind $(kind version | cut -d' ' -f2), kubectl $(kubectl version --client -o json | sed -n 's/.*"gitVersion": "\(v[^"]*\)".*/\1/p' | head -1), helm $(helm version --short)"
# Every kind node runs systemd, containerd and the kubelet as root, and they
# share root's inotify budget; at Linux' default (128) kube-proxy fails with
# "too many open files". See docs/DEVELOPMENT_SETUP.md.
inotify=$(cat /proc/sys/fs/inotify/max_user_instances)
(( inotify >= 512 )) || fail "fs.inotify.max_user_instances is $inotify, kind needs 512 (see docs/DEVELOPMENT_SETUP.md)"

step "Cluster $CLUSTER"
if cluster_exists; then
  echo "exists"
else
  kind create cluster --config "$K8S/kind.yaml" --wait 120s
fi
k create namespace "$NAMESPACE" --dry-run=client -o yaml | k apply -f - >/dev/null

step "Agones $AGONES_VERSION"
h upgrade --install agones agones --repo "$AGONES_CHART_REPO" --version "$AGONES_VERSION" \
  --namespace agones-system --create-namespace \
  --values "$K8S/agones/values.yaml" --wait --timeout 5m >/dev/null
k -n agones-system get deploy

step "Simulated distance: us node +${US_LATENCY_MS} ms"
# Everything the us node sends (its pods' traffic to other nodes and to the
# host) leaves through the node container's eth0, so one netem qdisc there
# delays the whole region, like region-us does in compose.
us_node=$(node_with mmoexile.dev/region=us)
docker exec "$us_node" tc qdisc replace dev eth0 root netem delay "${US_LATENCY_MS}ms"
docker exec "$us_node" tc qdisc show dev eth0

step "Images"
for name in migrate "${APPS[@]}" client; do
  echo "build $(image "$name")"
  build_image "$name"
done
echo "load into the nodes"
load_images mmoexile.dev/role=central $(for name in migrate account-api social orchestrator directory client; do image "$name"; done)
load_images mmoexile.dev/region $(image instance-server)

if [[ -d "$K8S/overlays/kind" ]]; then
  "$K8S/scripts/apply.sh"
fi

step "Ready"
cat <<EOF
Game        http://localhost:8090
Grafana     http://localhost:3040
Prometheus  http://localhost:9091
Fleet view  http://localhost:3013/servers
EOF
