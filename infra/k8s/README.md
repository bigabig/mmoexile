# The Realm on Kubernetes with Agones

The third way to run the realm (Stages 5 and 6), next to `pnpm dev` and
`pnpm realm:up`: a local [kind](https://kind.sigs.k8s.io/) cluster in which
[Agones](https://agones.dev/) runs the instance servers, with Postgres and
Redis next to the cluster like a cloud's managed databases. It exists for
what only a cluster has: autoscaling, rolling updates, Agones' protection
of busy servers, Kubernetes operations, and databases with their own
lifecycle, TLS and credentials. Daily development, the tests and the
regular CI don't need it.

| Target | Command | Used for |
| :--- | :--- | :--- |
| Local processes | `pnpm db:up` + `pnpm dev` | Daily development |
| Docker Compose | `pnpm realm:up` | The whole realm on one machine: load, chaos, region tests |
| Local Kubernetes + Agones | `pnpm cluster:up` | Autoscaling, rolling updates, Agones, Kubernetes operations |

All three run the same code; compose and the cluster also run the same
images with the same environment variables. Compose and the cluster can run
at the same time (different ports).

**Prerequisites:** Docker, kind, kubectl, Helm and openssl, and one system
setting (inotify instances); see [docs/DEVELOPMENT_SETUP.md](../../docs/DEVELOPMENT_SETUP.md).

## Commands

```bash
pnpm cluster:up                      # create or update everything (idempotent), ~7 min the first time
pnpm cluster:status                  # nodes, pods, fleets, GameServers, the orchestrator's view
pnpm cluster:reload instance-server  # rebuild one app and roll it out (any app name)
pnpm cluster:smoke                   # bots + scaling, rolling update, crash, TLS, database outages, ~11 min
pnpm cluster:down                    # delete the cluster; the databases keep running with all data
US_LATENCY_MS=120 pnpm cluster:up    # another simulated distance to the us node
```

The databases have their own commands; `cluster:up` runs the first two
itself when something is missing, so one command still works from nothing:

```bash
pnpm cluster:init                    # once: CA, certificates, passwords, keys into infra/k8s/.secrets/
pnpm cluster-db:up                   # Postgres, PgBouncer, Redis (+ exporters) next to the cluster
pnpm cluster-db:psql                 # psql as the user that owns the schema (arguments go to psql)
pnpm cluster-db:down                 # stop them; data (volume) and secrets stay
pnpm cluster-db:down -- --wipe       # also delete the data and the secrets
DB_LATENCY_MS=5 pnpm cluster-db:up   # another simulated distance to the databases (default 2)
pnpm cluster:init -- --rotate        # new passwords and keys (see "Rotating secrets")
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
Docker network "kind"
├── kind cluster "mmoexile" (each node is a Docker container)
│   ├── control-plane   Kubernetes itself (API server, scheduler, etcd, ...)
│   ├── central         account-api ×2, social, orchestrator, directory ×2, client,
│   │                   the migrate Job, Prometheus, Grafana, Agones' controller
│   ├── eu              Fleet instance-server-eu (2–4 GameServers), gateway-eu
│   └── us              Fleet instance-server-us (1–3 GameServers), gateway-us
│                       + tc netem: everything this node sends is 40 ms late
└── the "managed databases" (pnpm cluster-db:up, their own lifecycle)
    ├── mmoexile-db-postgres    Postgres 16, TLS only; volume mmoexile-db-postgres-data
    │   ├── mmoexile-db-pgbouncer          in Postgres' network namespace
    │   └── …-postgres-exporter, …-pgbouncer-exporter
    ├── mmoexile-db-redis       Redis 7, TLS only, no persistence
    │   └── …-redis-exporter
    └── + tc netem: what they send is DB_LATENCY_MS (2) late
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
| [`base/`](base) | The realm's manifests, without anything environment-specific (no databases, no secrets) |
| [`overlays/kind/`](overlays/kind) | What's specific to this cluster: node placement, host ports, where the databases are (`databases.yaml`), the generated secrets, region list, smaller servers |
| [`databases/`](databases) | The databases' configuration: `pg_hba.conf`, `setup.sql` (users and privileges), `pgbouncer.ini` (pooling, the connection budget), `redis.conf` |
| [`scripts/`](scripts) | `cluster-init`, `cluster-db-up`/`-down`/`-psql`, `cluster-up`, `apply`, `reload`, `status`, `cluster-down` |
| `.secrets/` | Generated by `cluster:init`, git-ignored, readable only by you |

`cluster:up` generates missing secrets, starts the databases, creates the
cluster, installs kube-prometheus-stack and Agones with Helm, applies the
delay, builds the images and loads them into the nodes (`kind load`,
nothing is pushed to a registry), then applies the manifests in order:
configuration, the databases' Services and their addresses, the migration
Job, the services, the Fleets.

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
- **Service without a selector + EndpointSlice**
  ([`overlays/kind/databases.yaml`](overlays/kind/databases.yaml)): a
  stable in-cluster name for something outside the cluster. Kubernetes
  doesn't look for pods; the EndpointSlice says where to send the traffic
  (here the database containers' addresses, set by the scripts). `postgres`,
  `pgbouncer` and `redis` are such names.
- **StatefulSet**: like a Deployment, but each pod has a stable identity and
  its own volume, as a database in the cluster would need. Stage 5 ran
  Postgres like that; since Stage 6 it runs outside.
- **Job** ([`base/migrate.yaml`](base/migrate.yaml)): runs a pod to
  completion once, here the database migration.
- **ConfigMap / Secret**: configuration and keys for pods, here generated
  by kustomize ([`base/kustomization.yaml`](base/kustomization.yaml), the
  secrets from `.secrets/` in the overlay) with a hash in their name, so
  changing a value rolls out the pods that use it. A Secret is only base64,
  not encrypted: whoever may read Secrets in the namespace reads the
  passwords (real clusters add RBAC, encryption at rest or an external
  secret store).
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

## The Databases Next to the Cluster

In production, databases usually aren't pods: they are managed services
(RDS, Cloud SQL, ElastiCache) with their own lifecycle, reached over the
network with TLS and credentials. `pnpm cluster-db:up` imitates that with
Docker containers on kind's network: deleting the cluster keeps every
account and character, and the services talk to the databases the way they
would in a cloud.

**How a pod reaches them:** the services connect to `pgbouncer:6432`,
`redis:6380` (and the migrate Job to `postgres:5432`): in-cluster names
(Services without a selector) whose EndpointSlices point at the
containers. `cluster-db:up` and `apply.sh` keep the addresses current.

**TLS with a local CA:** `cluster:init` creates a certificate authority (a
key that signs certificates) and a certificate per server, valid for the
names clients use (the Service names, the container names, localhost). The
CA's certificate is mounted into every pod (ConfigMap `database-ca`); a
client that trusts it can check that it really talks to our Postgres, not
to anything that answers on that address. Postgres, PgBouncer and Redis
accept only TLS. Watch out with Prisma: it checks the certificate only with
`sslaccept=strict` (in `DATABASE_URL`, with `sslcert=<CA file>`); without
it, Prisma accepts any certificate. ioredis checks against `REDIS_CA_FILE`.

**Least privilege:** each user may do only what it needs.

| User | Used by | May |
| :--- | :--- | :--- |
| `mmoexile_migrate` | the migrate Job, `cluster-db:psql` | own the schema: create and change tables |
| `mmoexile_app` | the services, through PgBouncer | read and write rows; no `CREATE`, `ALTER`, `DROP`, `TRUNCATE` |
| `mmoexile_monitor` | the exporters | read Postgres' statistics (`pg_monitor`), at most 3 connections |
| `postgres` (superuser) | only from inside the container | everything; refused over the network (`pg_hba.conf`) |
| Redis `mmoexile` | the services | all commands except `@admin` and `@dangerous` (no `FLUSHALL`, `CONFIG`, `KEYS`, …) |
| Redis `monitor` | the exporter | `INFO` and a few read-only commands |
| Redis `default` | nobody | disabled |

A service that gets compromised can then damage rows, but not the schema,
other databases or the server.

### Connection budget

Every Prisma client keeps a pool of connections; by default up to
2 × CPU cores + 1 per process (129 on a 64-core machine, more than
Postgres' default of 100 in total). So each service sets its pool
(`DATABASE_POOL_SIZE`): account-api 5 per pod, instance servers 3 per
server. Those are *client* connections to **PgBouncer**, which runs in
**transaction pooling** mode: a connection to Postgres belongs to a client
only for the duration of one transaction. Many clients share few server
connections:

| | Connections |
| :--- | :--- |
| Clients at the fleets' maximum (kind) | account-api 2 × 5 + instance servers (eu 4 + 1 during a rolling update, us 3 + 1) × 3 = 37 |
| PgBouncer → Postgres | at most `default_pool_size` 20 + `reserve_pool_size` 5, capped by `max_db_connections` 30 |
| Postgres `max_connections` 100 | ≥ 30 (PgBouncer) + 1 (migrations) + 3 (monitoring) + 3 reserved for the superuser |

`max_client_conn` (1000) leaves room for ~300 servers without touching
Postgres. Transaction pooling has one rule: no session state across
transactions (`SET`, advisory locks, `LISTEN`); our services use single
statements, and Prisma's prepared statements work through PgBouncer
(`max_prepared_statements`). Measured with the eu fleet at its maximum
(180 bots): 19 client connections, 6 to Postgres. Grafana's "Databases"
row shows both.

### Outages

There is one Postgres and one Redis, without failover (that would be the
next step in a real setup). Instead, a short outage must not kick anyone
([docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#database-outages)):

- **Postgres away (30 s):** players keep playing; saves are kept and
  retried, and written once it is back; zone changes are refused with a
  chat message (a zone change that runs into the outage waits for its
  save); logins get a 503 "try again in a moment" after at most 5 s.
- **Redis away (10 s, shorter than the 30 s lease):** commands wait, then
  continue. If Redis restarts empty, servers take their characters'
  leases back; parties and presence are rebuilt, messages in flight are
  lost.

Try it with bots online and Grafana open:

```bash
docker pause mmoexile-db-postgres; sleep 30; docker unpause mmoexile-db-postgres
docker pause mmoexile-db-redis; sleep 10; docker unpause mmoexile-db-redis
```

### Rotating secrets

`pnpm cluster:init -- --rotate` creates new passwords and keys (the CA and
certificates stay; `--rotate-ca` replaces those too). Then
`pnpm cluster-db:up` gives the databases the new passwords, and
`pnpm cluster:up` (or `scripts/apply.sh` plus
`pnpm cluster:reload instance-server`) rolls them out to the pods. In
between, pods with the old passwords can't open new connections, and
servers with the old ticket key reject tickets signed with the new one: a
short outage. Real systems rotate without one by allowing two valid
credentials at a time (create the new one, roll out, then delete the old
one).

### Distance

The database containers delay what they send by `DB_LATENCY_MS` (2 ms, as
if in another availability zone); PgBouncer reaches Postgres on localhost,
undelayed. Measured with 10 bots per region between nexus and overworld
(zone change: ticket issued → admitted on the target, incl. reconnect):

| | Character write p50 | Zone change eu p50 / p95 | Zone change us p50 / p95 |
| :--- | :--- | :--- | :--- |
| Compose (Stage 4) | | 7 / 22 ms | 232 / 292 ms |
| Cluster, databases 0 ms away (TLS, PgBouncer) | 2.2 ms | 14 / 24 ms | 261 / 296 ms |
| Cluster, databases 2 ms away | 4.0 ms | 18 / 25 ms | 276 / 299 ms |

![The Databases row during pnpm cluster:smoke](../../docs/images/cluster-databases.png)

*The "Databases" row during `pnpm cluster:smoke`: Postgres sees a handful
of connections (of 100) while PgBouncer serves up to 16 clients; at the
end, the 30 s Postgres outage (failed zone-change saves, retried) and the
10 s Redis outage.*

A zone change makes three sequential database round trips (save, claim +
lease, take over), so 2 ms more per round trip shows up as a few ms. In us
the 40 ms per round trip dominate. The cluster's own network (kube-proxy,
another node) costs a few ms more than compose.

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
kubectl -n mmoexile get endpointslices        # incl. where the databases are
docker ps --filter label=mmoexile.dev/database  # the databases and exporters
pnpm cluster-db:psql -- -c 'select count(*) from "Character"'
```

![Realm Overview in the cluster during pnpm cluster:smoke](../../docs/images/cluster-grafana.png)

*The Realm Overview in the cluster's Grafana during `pnpm cluster:smoke`:
bots in both regions, 70 more in eu (the eu fleet goes from 2 to 3 servers
and back), the rolling update (new servers in "Players per server") and a
crashed server (the dead one on the right of "Draining / dead servers").*
