#!/usr/bin/env bash
# pnpm cluster:down — deletes the clusters and cloud-provider-kind with its
# load balancer containers. Everything in the clusters (Agones, monitoring,
# the mesh, the images loaded into them) goes with them; the databases
# next to them keep running with all data (pnpm cluster-db:down), and the
# images built on the host (mmoexile/*:dev) stay for the next cluster:up.
# kind's Docker network ("kind") is removed too once nothing uses it any
# more.
source "$(dirname "$0")/lib.sh"

# Also the single cluster of Stages 5 and 6, if it is still there
for name in "${CLUSTERS[@]/#/mmoexile-}" mmoexile; do
  if kind get clusters 2>/dev/null | grep -qx "$name"; then
    kind delete cluster --name "$name"
  fi
done

# cloud-provider-kind, and the load balancers it started (one Envoy
# container per LoadBalancer Service; they outlive the clusters otherwise)
docker rm -f "$CLOUD_PROVIDER_KIND" >/dev/null 2>&1 && echo "Removed $CLOUD_PROVIDER_KIND" || true
load_balancers=$(load_balancer_containers)
if [[ -n "$load_balancers" ]]; then
  docker rm -f $load_balancers >/dev/null
  echo "Removed load balancers: $(echo $load_balancers)"
fi

remove_unused_network
