# Shared settings and helpers for the cluster scripts (sourced, not run).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
K8S="$ROOT/infra/k8s"

CLUSTER=mmoexile
CONTEXT="kind-$CLUSTER"
NAMESPACE=mmoexile

AGONES_CHART_REPO=https://agones.dev/chart/stable
AGONES_VERSION=1.61.0
MONITORING_CHART_REPO=https://prometheus-community.github.io/helm-charts
MONITORING_VERSION=91.9.0  # kube-prometheus-stack

# Apps built from node.Dockerfile (plus the "migrate" and "client" images)
APPS=(account-api social orchestrator directory instance-server)
IMAGE_TAG=dev

# kubectl and helm, always against our cluster (never the current context)
k() { kubectl --context "$CONTEXT" "$@"; }
h() { helm --kube-context "$CONTEXT" "$@"; }

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

cluster_exists() { kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; }

# The kind node (= Docker container) carrying a label, e.g. node_with mmoexile.dev/region=us
node_with() {
  k get nodes -l "$1" -o jsonpath='{.items[0].metadata.name}'
}

image() { echo "mmoexile/$1:$IMAGE_TAG"; }

# Builds one image from the repository: an app, "migrate" or "client"
build_image() {
  local name=$1
  case "$name" in
    client) docker build -q -f "$ROOT/infra/docker/client.Dockerfile" -t "$(image client)" "$ROOT" ;;
    migrate) docker build -q -f "$ROOT/infra/docker/node.Dockerfile" --target migrate -t "$(image migrate)" "$ROOT" ;;
    *) docker build -q -f "$ROOT/infra/docker/node.Dockerfile" --build-arg "APP=$name" -t "$(image "$name")" "$ROOT" ;;
  esac >/dev/null
}

# Loads images into the nodes that run them: load_images <node label> <image>...
# (kind skips images a node already has in the same version)
load_images() {
  local nodes
  nodes=$(k get nodes -l "$1" -o jsonpath='{.items[*].metadata.name}' | tr ' ' ',')
  shift
  kind load docker-image --name "$CLUSTER" --nodes "$nodes" "$@" 2>&1 | grep -vE "not yet present|already present" || true
}
