# Development Setup

What you need on your machine, and what each tool is for. Only the first
group is needed for daily development; the second only for the Kubernetes
deployment target (Stage 5).

## Always

| Tool | Version | What for |
| :--- | :--- | :--- |
| Node.js | v20+ (tested on v24) | Runs every app and tool |
| pnpm | v12 (`corepack enable pnpm`) | Workspace package manager |
| Docker with Compose | recent | Postgres and Redis for `pnpm dev` (`pnpm db:up`), the full realm (`pnpm realm:up`), throwaway databases in tests (Testcontainers) |

## For the Kubernetes target (optional)

`pnpm dev`, `pnpm realm:up`, all tests and CI work without these. They are
only needed to run the realm on local Kubernetes clusters with Agones and
Linkerd (three clusters; about 10 GB of memory).

| Tool | Tested with | What it does |
| :--- | :--- | :--- |
| [kind](https://kind.sigs.k8s.io/) | v0.33.0 | Creates and deletes local Kubernetes clusters that run inside Docker containers; loads our images into them |
| [kubectl](https://kubernetes.io/docs/reference/kubectl/) | v1.37.1 | The command-line client for any Kubernetes cluster: apply manifests, list pods, read logs, debug |
| [Helm](https://helm.sh/) | v4.3.0 | Package manager for Kubernetes; installs Agones, Linkerd and monitoring into the clusters |
| [Linkerd CLI](https://linkerd.io/2/reference/cli/) | edge-26.9.3 (exactly; `cluster:up` checks it) | Talks to the service mesh: links the clusters (`multicluster link-gen`), checks them (`check`, `multicluster gateways`), shows a proxy's metrics |
| [OpenSSL](https://www.openssl.org/) | 3.0 | `pnpm cluster:init` creates the local CA, the databases' certificates, passwords and keys with it; usually preinstalled (`openssl version`) |

Agones and Linkerd themselves are not installed on your machine: they are
installed *into* the clusters and disappear with them. Only Linkerd's
*edge* releases are free builds (stable releases come from Buoyant), so we
pin one. Agones 1.61 supports Kubernetes 1.34–1.36,
so the cluster is pinned to 1.36; kubectl may be one minor version newer or
older than the cluster.

### Installing into `~/.local/bin` (no sudo)

Each command downloads the official release, verifies its checksum and
installs it into your home directory (`~/.local/bin` must be on your `PATH`).

```bash
# kubectl (latest stable)
cd /tmp && V=$(curl -fsSL https://dl.k8s.io/release/stable.txt) \
  && curl -fsSLO "https://dl.k8s.io/release/$V/bin/linux/amd64/kubectl" \
  && curl -fsSLO "https://dl.k8s.io/release/$V/bin/linux/amd64/kubectl.sha256" \
  && echo "$(cat kubectl.sha256)  kubectl" | sha256sum --check \
  && install -m 0755 kubectl ~/.local/bin/kubectl && rm kubectl kubectl.sha256

# kind (latest release)
cd /tmp && curl -fsSLo kind https://github.com/kubernetes-sigs/kind/releases/latest/download/kind-linux-amd64 \
  && curl -fsSLo kind.sha256sum https://github.com/kubernetes-sigs/kind/releases/latest/download/kind-linux-amd64.sha256sum \
  && echo "$(cut -d' ' -f1 kind.sha256sum)  kind" | sha256sum --check \
  && install -m 0755 kind ~/.local/bin/kind && rm kind kind.sha256sum

# Helm (official script; verifies the checksum itself)
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4 \
  | HELM_INSTALL_DIR=$HOME/.local/bin USE_SUDO=false bash

# Linkerd CLI (the version infra/k8s/scripts/lib.sh pins). Linkerd publishes
# no checksum files; GitHub shows each release asset's SHA-256 digest.
V=edge-26.9.3; cd /tmp && curl -fsSLo linkerd "https://github.com/linkerd/linkerd2/releases/download/$V/linkerd2-cli-$V-linux-amd64" \
  && sha256sum linkerd \
  && install -m 0755 linkerd ~/.local/bin/linkerd && rm linkerd
# compare the sum with the asset's digest on https://github.com/linkerd/linkerd2/releases/tag/edge-26.9.3
# (or: gh api repos/linkerd/linkerd2/releases/tags/$V --jq '.assets[] | select(.name | endswith("linux-amd64")) | .digest')

# Check
kubectl version --client && kind version && helm version && linkerd version --client
```

For macOS or ARM machines, replace `linux/amd64` / `linux-amd64` with your
platform (e.g. `darwin/arm64`), or use a package manager (`brew install kind kubectl helm`;
Linkerd's CLI in the pinned version from its GitHub releases).

### One system setting: inotify instances (needs sudo once)

Every kind node is a container running systemd, containerd and the kubelet
as root, and they all draw on root's budget of inotify instances. At the
Linux default of 128, kube-proxy fails with "too many open files" and pods
can't reach anything. kind's documentation recommends 512 (see its
[known issues](https://kind.sigs.k8s.io/docs/user/known-issues/#pod-errors-due-to-too-many-open-files));
`pnpm cluster:up` checks it.

```bash
echo 'fs.inotify.max_user_instances = 512' | sudo tee /etc/sysctl.d/99-kind.conf && sudo sysctl --system
```

The kubelet also can't read disk statistics when Docker stores its data on
ZFS or btrfs; `infra/k8s/kind-*.yaml` work around that themselves, nothing to do.

### Uninstalling

```bash
rm ~/.local/bin/{kubectl,kind,helm,linkerd}
rm -rf ~/.kube ~/.cache/helm ~/.config/helm   # created once the tools were used
sudo rm /etc/sysctl.d/99-kind.conf            # the inotify setting (back to the default after a reboot)
```
