#!/usr/bin/env bash
# pnpm cluster:down — deletes the cluster. Everything in it (Agones, the
# databases' volumes, the images loaded into it) goes with it; the images
# built on the host (mmoexile/*:dev) stay for the next cluster:up.
source "$(dirname "$0")/lib.sh"

if cluster_exists; then
  kind delete cluster --name "$CLUSTER"
else
  echo "No cluster $CLUSTER"
fi
