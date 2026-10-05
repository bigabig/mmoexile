#!/usr/bin/env bash
# pnpm cluster:down — deletes the cluster. Everything in it (Agones, the
# databases' volumes, the images loaded into it) goes with it; the images
# built on the host (mmoexile/*:dev) stay for the next cluster:up. kind's
# Docker network ("kind") is removed too, unless another kind cluster uses it.
source "$(dirname "$0")/lib.sh"

if cluster_exists; then
  kind delete cluster --name "$CLUSTER"
else
  echo "No cluster $CLUSTER"
fi

if [[ -z "$(kind get clusters 2>/dev/null)" ]] && docker network inspect kind >/dev/null 2>&1; then
  docker network rm kind >/dev/null && echo "Removed Docker network kind"
fi
