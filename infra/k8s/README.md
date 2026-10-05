# The Realm on Kubernetes with Agones

The third way to run the realm (Stage 5), next to `pnpm dev` and
`pnpm realm:up`: a local [kind](https://kind.sigs.k8s.io/) cluster in which
[Agones](https://agones.dev/) runs the instance servers. It exists for what
only a cluster has: autoscaling, rolling updates, Agones' protection of
busy servers, and Kubernetes operations. Daily development, the tests and
the regular CI don't need it.

| Target | Command | Used for |
| :--- | :--- | :--- |
| Local processes | `pnpm db:up` + `pnpm dev` | Daily development |
| Docker Compose | `pnpm realm:up` | The whole realm on one machine: load, chaos, region tests |
| Local Kubernetes + Agones | `pnpm cluster:up` | Autoscaling, rolling updates, Agones, Kubernetes operations |

All three run the same code; compose and the cluster also run the same
images with the same environment variables. Compose and the cluster can run
at the same time (different ports).

**Prerequisites:** Docker, kind, kubectl and Helm, and one system setting
(inotify instances); see [docs/DEVELOPMENT_SETUP.md](../../docs/DEVELOPMENT_SETUP.md).

## Commands

```bash
pnpm cluster:up                      # create or update everything (idempotent), ~5 min the first time
pnpm cluster:status                  # nodes, pods, fleets, GameServers, the orchestrator's view
pnpm cluster:reload instance-server  # rebuild one app and roll it out (any app name)
pnpm cluster:smoke                   # bots + scaling, rolling update and crash checks, ~8 min
pnpm cluster:down                    # delete the cluster and everything in it
US_LATENCY_MS=120 pnpm cluster:up    # another simulated distance to the us node
```

| What | Where |
| :--- | :--- |
| Game | http://localhost:8090 |
| Grafana (Realm Overview + Kubernetes dashboards) | http://localhost:3040 |
| Prometheus | http://localhost:9091 |
| Orchestrator's fleet view | http://localhost:3013/servers |
| Game servers eu / us (Agones host ports) | localhost:7300–7319 / 7400–7419 |
| Region pings eu / us | localhost:7350/ping / 7450/ping |

## What Runs Where

```
kind cluster "mmoexile" (each node is a Docker container)
├── control-plane   Kubernetes itself (API server, scheduler, etcd, ...)
├── central         account-api ×2, social, orchestrator, directory ×2, client,
│                   Postgres, Redis, the migrate Job, Prometheus, Grafana,
│                   Agones' controller
├── eu              Fleet instance-server-eu (2–4 GameServers), gateway-eu
└── us              Fleet instance-server-us (1–3 GameServers), gateway-us
                    + tc netem: everything this node sends is 40 ms late
```

Players reach the cluster like a cloud: the client on the central node
(port 8090), each region's gateway and game servers on that region's node.
`kind.yaml` publishes those ports on localhost. The us node's delay applies
to everything it sends: to players, to the central services and databases,
and to the cluster DNS (so DNS lookups from us pods also pay it).

## Files

| File | What it is |
| :--- | :--- |
| [`kind.yaml`](kind.yaml) | The cluster: nodes, their labels, port mappings, Kubernetes version |
| [`agones/values.yaml`](agones/values.yaml) | Agones' Helm values: port ranges per region, components on the central node |
| [`monitoring/values.yaml`](monitoring/values.yaml) | kube-prometheus-stack's Helm values: Prometheus, Grafana |
| [`base/`](base) | The realm's manifests, without anything environment-specific |
| [`overlays/kind/`](overlays/kind) | What's specific to this cluster: node placement, host ports, local keys, region list, smaller servers |
| [`scripts/`](scripts) | `cluster-up`, `apply`, `reload`, `status`, `cluster-down` |

`cluster:up` creates the cluster, installs kube-prometheus-stack and Agones
with Helm, applies the delay, builds the images and loads them into the
nodes (`kind load`, nothing is pushed to a registry), then applies the
manifests in order: configuration and data, the migration Job, the
services, the Fleets.

## A Short Kubernetes Primer, With Our Files

- **Pod**: one or more containers that run together on one node and share
  an IP. Pods are disposable: they are replaced, not repaired.
- **Deployment** ([`base/account-api.yaml`](base/account-api.yaml)): keeps N
  identical pods running and replaces them one by one on a change (rolling
  update). Probes tell Kubernetes when a pod has started (`startupProbe`),
  is ready for traffic (`readinessProbe`, our `/ready`) and must be
  restarted (`livenessProbe`, our `/health`). The orchestrator uses
  `strategy: Recreate`, so an old and a new one never run side by side.
- **Service**: a stable name and virtual IP for a set of pods (by label),
  e.g. `http://social:3002`. `NodePort` additionally opens a port on every
  node; that's how the client, Grafana and the orchestrator reach localhost.
- **StatefulSet** ([`base/data.yaml`](base/data.yaml)): like a Deployment,
  but each pod has a stable identity and its own volume
  (`volumeClaimTemplates` → a PersistentVolumeClaim), which Postgres needs.
- **Job**: runs a pod to completion once, here the database migration.
- **ConfigMap / Secret**: configuration and keys for pods, here generated
  by kustomize ([`base/kustomization.yaml`](base/kustomization.yaml)) with a
  hash in their name, so changing a value rolls out the pods that use it.
- **Node selector / labels**: `mmoexile.dev/role=central` and
  `mmoexile.dev/region=eu|us` decide which node runs what.
- **Namespace**: our objects live in `mmoexile`; Agones in `agones-system`,
  monitoring in `monitoring`.
- **kustomize** (`kubectl kustomize`): builds the final manifests from the
  base plus an overlay's patches. **Helm** installs packaged third-party
  software (Agones, kube-prometheus-stack) with a values file.

## Agones, With Our Files

Agones adds game-server resources to Kubernetes
([`base/instance-servers.yaml`](base/instance-servers.yaml)):

- **GameServer**: one instance server pod plus Agones' SDK sidecar, with a
  host port from the region's port range. Its state is what Agones
  manages: `Scheduled` → `Ready` (available) ⇄ `Allocated` (in use) →
  `Shutdown`; `Unhealthy` if health pings stop.
- **Fleet**: keeps N GameServers of one template, like a Deployment, and
  rolls out changes. One per region.
- **FleetAutoscaler**: sets N. Ours keeps a buffer of free player slots,
  read from the `players` Counter of every GameServer (eu: 60 free slots,
  2–4 servers; us: 60, 1–3).

The orchestrator still decides where every player goes (D13). Agones only
handles the lifecycle and the number of servers. The instance server
connects the two (`LIFECYCLE=agones`, `apps/instance-server/src/fleet/Agones*.ts`):

- it registers with the orchestrator as always, with the host port Agones
  assigned (`PUBLIC_URL` from the GameServer);
- it is **Allocated while it has players** (or the orchestrator just sent
  one there: the `hold` flag, and before answering a create-instance
  call), **Ready when empty**. Agones only scales down and replaces Ready
  servers, so a server with players is never removed;
- it keeps the `players` Counter current and pings Health;
- on SIGTERM it drains as everywhere else, then calls Shutdown.

**Rolling update** (`pnpm cluster:reload instance-server`): Agones
replaces old Ready servers itself, but never Allocated ones, and it counts
those toward the Fleet's size: while every old server has players, it
starts no new one. So the script first gives the FleetAutoscaler room for
one more server (its minimum + one server), which Agones starts in the new
version. Then it drains the old servers through the orchestrator one at a
time (hub players move at once, dungeons get `DRAIN_TIMEOUT_SEC`, 60 s);
each one is replaced by a new-version server before the next is drained.
Finally the autoscaler's bounds are put back. Nobody is kicked; with 40
bots playing it takes about a minute.

A draining server keeps pinging Health: without it, Agones would declare it
Unhealthy after 15 s and kill it mid-drain.

**Autoscaling** reacts within ~10–15 s (the autoscaler checks every 10 s,
a new server needs a few seconds to start). A burst of players larger than
the buffer fills the region in the meantime: those logins and portal hops
fail with "region unavailable" until the new server is up. A bigger buffer
avoids that at the cost of idle servers. An empty dungeon that was still
asleep on a server removed by scale-down is lost, like one that timed out.

## Looking Around

```bash
kubectl config use-context kind-mmoexile      # kind sets this when it creates the cluster
kubectl -n mmoexile get pods -o wide          # what runs on which node
kubectl -n mmoexile get gameservers           # GameServers, their state, port and node
kubectl -n mmoexile get fleets,fleetautoscalers
kubectl -n mmoexile logs deploy/orchestrator -f
kubectl -n mmoexile logs <gameserver-name> -c instance-server -f
kubectl -n mmoexile describe gameserver <name>  # events: Ready, Allocated, Unhealthy, ...
kubectl -n mmoexile delete pod <gameserver-name>  # the pod drains, Agones replaces it
kubectl -n mmoexile get events --sort-by=.lastTimestamp
```

![Realm Overview in the cluster during pnpm cluster:smoke](../../docs/images/cluster-grafana.png)

*The Realm Overview in the cluster's Grafana during `pnpm cluster:smoke`:
bots in both regions, 70 more in eu (the eu fleet goes from 2 to 3 servers
and back), the rolling update (new servers in "Players per server") and a
crashed server (the dead one on the right of "Draining / dead servers").*
