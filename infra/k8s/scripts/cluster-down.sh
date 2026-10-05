#!/usr/bin/env bash
# pnpm cluster:down — deletes the cluster. Everything in it (Agones,
# monitoring, the images loaded into it) goes with it; the databases next
# to it keep running with all data (pnpm cluster-db:down), and the images
# built on the host (mmoexile/*:dev) stay for the next cluster:up. kind's
# Docker network ("kind") is removed too once nothing uses it any more.
source "$(dirname "$0")/lib.sh"

if cluster_exists; then
  kind delete cluster --name "$CLUSTER"
else
  echo "No cluster $CLUSTER"
fi

remove_unused_network
