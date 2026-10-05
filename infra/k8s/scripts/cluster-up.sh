#!/usr/bin/env bash
# pnpm cluster:up — the realm on three local Kubernetes clusters: "central"
# (the central services and monitoring) and one per region ("eu", "us",
# each with Agones and its instance servers). Idempotent: creates what is
# missing, updates the rest, and can be re-run at any time (e.g. after
# changing manifests or code).
#
#   US_LATENCY_MS=120 pnpm cluster:up   → the simulated distance to the us cluster
source "$(dirname "$0")/lib.sh"

US_LATENCY_MS=${US_LATENCY_MS:-40}

step "Tools"
for tool in docker kind kubectl helm openssl linkerd; do
  command -v "$tool" >/dev/null || fail "$tool not found (see docs/DEVELOPMENT_SETUP.md)"
done
echo "kind $(kind version | cut -d' ' -f2), kubectl $(kubectl version --client -o json | sed -n 's/.*"gitVersion": "\(v[^"]*\)".*/\1/p' | head -1), helm $(helm version --short), linkerd $(linkerd version --client --short)"
[[ "$(linkerd version --client --short)" == "$LINKERD_CLI_VERSION" ]] ||
  fail "linkerd CLI $(linkerd version --client --short), expected $LINKERD_CLI_VERSION (see docs/DEVELOPMENT_SETUP.md)"
# Every kind node runs systemd, containerd and the kubelet as root, and they
# share root's inotify budget; at Linux' default (128) kube-proxy fails with
# "too many open files". See docs/DEVELOPMENT_SETUP.md.
inotify=$(cat /proc/sys/fs/inotify/max_user_instances)
(( inotify >= 512 )) || fail "fs.inotify.max_user_instances is $inotify, kind needs 512 (see docs/DEVELOPMENT_SETUP.md)"

"$K8S/scripts/cluster-init.sh"
"$K8S/scripts/cluster-db-up.sh"

step "Clusters"
# The single cluster of Stages 5 and 6 holds the same host ports
! kind get clusters 2>/dev/null | grep -qx mmoexile || fail "The single cluster \"mmoexile\" of Stage 6 still exists: pnpm cluster:down removes it"
for cluster in "${CLUSTERS[@]}"; do
  if cluster_exists "$cluster"; then
    echo "$(cluster_name "$cluster") exists"
  else
    kind create cluster --config "$K8S/kind-$cluster.yaml" --wait 120s
  fi
  # The node is control plane and worker at once; kubeadm marks control
  # plane nodes as unsuitable for load balancers, which would leave our
  # LoadBalancer Services without a backend
  kc "$cluster" label node "$(node_container "$cluster")" node.kubernetes.io/exclude-from-external-load-balancers- >/dev/null 2>&1 || true
done

step "Load balancers: cloud-provider-kind"
if [[ "$(docker inspect -f '{{.State.Running}}' "$CLOUD_PROVIDER_KIND" 2>/dev/null)" == true ]]; then
  echo "running"
else
  docker rm -f "$CLOUD_PROVIDER_KIND" >/dev/null 2>&1 || true
  # Talks to Docker to start a load balancer container per LoadBalancer
  # Service; Gateway API and the default Ingress are not needed
  docker run -d --name "$CLOUD_PROVIDER_KIND" --network "$DB_NETWORK" --restart unless-stopped \
    -v /var/run/docker.sock:/var/run/docker.sock \
    "$CLOUD_PROVIDER_KIND_IMAGE" --gateway-channel disabled --enable-default-ingress=false >/dev/null
  echo "started $CLOUD_PROVIDER_KIND"
fi

step "Simulated distance: us cluster +${US_LATENCY_MS} ms"
# Everything the us node sends (to players on the host, to the other
# clusters, to the databases) leaves through its container's eth0, so one
# netem qdisc there delays the whole region, like region-us does in compose.
docker exec "$(node_container us)" tc qdisc replace dev eth0 root netem delay "${US_LATENCY_MS}ms"
docker exec "$(node_container us)" tc qdisc show dev eth0

step "Service mesh: Linkerd $LINKERD_CLI_VERSION"
install_linkerd() {
  local cluster=$1
  # Linkerd's policy resources build on the Gateway API's (HTTPRoute)
  kc "$cluster" apply --server-side -f \
    "https://github.com/kubernetes-sigs/gateway-api/releases/download/$GATEWAY_API_VERSION/standard-install.yaml" >/dev/null
  hc "$cluster" upgrade --install linkerd-crds linkerd-crds --repo "$LINKERD_CHART_REPO" --version "$LINKERD_VERSION" \
    --namespace linkerd --create-namespace --wait >/dev/null
  # Trust anchor: our CA (its certificate only; the key stays in .secrets).
  # Issuer: this cluster's, signed by the CA (cluster:init).
  hc "$cluster" upgrade --install linkerd-control-plane linkerd-control-plane --repo "$LINKERD_CHART_REPO" --version "$LINKERD_VERSION" \
    --namespace linkerd --values "$K8S/linkerd/values.yaml" \
    --set-file identityTrustAnchorsPEM="$SECRETS/ca.crt" \
    --set-file identity.issuer.tls.crtPEM="$SECRETS/linkerd-issuer-$cluster.crt" \
    --set-file identity.issuer.tls.keyPEM="$SECRETS/linkerd-issuer-$cluster.key" \
    --wait --timeout 5m >/dev/null
  linkerd_check "$cluster"
  # The realm's namespace: every pod gets a proxy, which lets in only
  # what a policy authorizes (base/*/policies.yaml)
  kc "$cluster" apply -f - >/dev/null <<END
apiVersion: v1
kind: Namespace
metadata:
  name: $NAMESPACE
  annotations:
    linkerd.io/inject: enabled
    config.linkerd.io/default-inbound-policy: deny
END
}
for_clusters install_linkerd "${CLUSTERS[@]}"

step "Multicluster: gateways and links"
install_multicluster() {
  local cluster=$1 controllers=() i=0 target ip
  # One service mirror ("controller") per cluster this one links to
  for target in $(linked_clusters "$cluster"); do
    controllers+=(--set "controllers[$i].link.ref.name=$target")
    i=$((i + 1))
  done
  hc "$cluster" upgrade --install linkerd-multicluster linkerd-multicluster --repo "$LINKERD_CHART_REPO" --version "$LINKERD_VERSION" \
    --namespace linkerd-multicluster --create-namespace --values "$K8S/linkerd/multicluster.yaml" "${controllers[@]}" >/dev/null
  # Who may enter through the gateway (D32): the chart lets in any meshed
  # identity of a cluster sharing our trust anchor; we narrow its
  # MeshTLSAuthentication to the workloads that call across clusters.
  # (Linkerd's identities don't name the cluster: an instance server's is
  # the same in eu and us.)
  local identities
  case "$cluster" in
    central) identities='["instance-server.mmoexile.serviceaccount.identity.linkerd.cluster.local"]' ;;
    *) identities='["orchestrator.mmoexile.serviceaccount.identity.linkerd.cluster.local"]' ;;
  esac
  kc "$cluster" -n linkerd-multicluster patch meshtlsauthentication any-meshed --type merge \
    -p "{\"spec\":{\"identities\":$identities}}" >/dev/null
  kc "$cluster" -n linkerd-multicluster rollout status deploy/linkerd-gateway --timeout=180s >/dev/null
  for _ in $(seq 60); do
    ip=$(kc "$cluster" -n linkerd-multicluster get svc linkerd-gateway -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
    [[ -n "$ip" ]] && break
    sleep 2
  done
  [[ -n "$ip" ]] || { echo "the gateway got no load balancer address" >&2; return 1; }
  echo "gateway $ip:4143"
}
for_clusters install_multicluster "${CLUSTERS[@]}"
# A link lets <source> mirror <target>'s exported Services: the target
# generates a Link (its gateway's address, its API server, credentials of a
# ServiceAccount that may only read Services) that is applied in the
# source. The API server is addressed by the node's name on kind's network.
for source in "${CLUSTERS[@]}"; do
  for target in $(linked_clusters "$source"); do
    linkerd --context "$(context "$target")" multicluster link-gen --cluster-name "$target" \
      --api-server-address "https://$(node_container "$target"):6443" | kc "$source" apply -f - >/dev/null
    echo "$source mirrors $target"
  done
done
# Every link alive: the service mirror probes the target's gateway through
# the mesh. (`linkerd multicluster check` would also try to reach the
# targets' API servers from this host, which doesn't resolve the nodes'
# names on kind's network.)
wait_for_gateways() {
  local cluster=$1 gateways
  for _ in $(seq 60); do
    gateways=$(linkerd --context "$(context "$cluster")" multicluster gateways 2>/dev/null | tail -n +2)
    [[ -n "$gateways" ]] && ! grep -qv " True " <<<"$gateways" &&
      (( $(wc -l <<<"$gateways") == $(wc -w <<<"$(linked_clusters "$cluster")") )) && break
    sleep 3
  done
  linkerd --context "$(context "$cluster")" multicluster gateways 2>/dev/null
  ! grep -qv " True " <<<"$gateways" || { echo "a linked cluster's gateway isn't reachable" >&2; return 1; }
}
for_clusters wait_for_gateways "${CLUSTERS[@]}"

step "Monitoring: kube-prometheus-stack $MONITORING_VERSION"
# First, so that Agones' ServiceMonitor (its controller metrics) has its CRD
install_monitoring() {
  local values=values-region.yaml
  [[ "$1" == central ]] && values=values.yaml
  hc "$1" upgrade --install monitoring kube-prometheus-stack --repo "$MONITORING_CHART_REPO" --version "$MONITORING_VERSION" \
    --namespace monitoring --create-namespace \
    --values "$K8S/monitoring/$values" --wait --timeout 10m >/dev/null
  kc "$1" -n monitoring get deploy,statefulset
}
for_clusters install_monitoring "${CLUSTERS[@]}"

step "Agones $AGONES_VERSION (regions)"
install_agones() {
  hc "$1" upgrade --install agones agones --repo "$AGONES_CHART_REPO" --version "$AGONES_VERSION" \
    --namespace agones-system --create-namespace \
    --values "$K8S/agones/values.yaml" --wait --timeout 5m \
    >/dev/null 2> >(grep -v 'unrecognized format "int-or-string"' >&2)  # noise from Agones' CRD schemas
  kc "$1" -n agones-system get deploy
}
for_clusters install_agones "${REGIONS[@]}"

step "Images"
for name in migrate "${APPS[@]}" client; do
  echo "build $(image "$name")"
  build_image "$name"
done
for cluster in "${CLUSTERS[@]}"; do
  echo "load into $cluster"
  load_images "$cluster" $(cluster_images "$cluster")
done

"$K8S/scripts/apply.sh"

step "Ready"
cat <<EOF
Game        http://localhost:8090
Grafana     http://localhost:3040
Prometheus  http://localhost:9091
Fleet view  http://localhost:3013/servers
EOF
