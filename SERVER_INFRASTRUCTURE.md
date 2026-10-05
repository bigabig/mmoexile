# Server Infrastructure: Target Architecture & Terminology

This document defines the target server infrastructure for the MMO. It is modeled on instanced ARPGs such as Path of Exile, and on the original Realm of the Mad God's reconnect-based world switching. It sets the shared vocabulary, the target architecture, and the staged migration path from today's single process.

> The game does not need this infrastructure at launch. The goal is to get the concepts and boundaries right early, because they are hard to retrofit.

---

## 1. The Hierarchy (top → bottom)

```
Realm                        one universe: one character DB, one economy
 └─ Gateway (Region)         a datacenter location: EU-Frankfurt, US-Texas, …
     └─ Node                 one physical/virtual machine
         └─ Instance Server  one OS process (≈ one per CPU core)
             └─ Instance     one live, ticking copy of a Zone
                 └─ Entities players, monsters, projectiles, loot bags
```

| Term | What it is | Typical count | In the repo today |
| :--- | :--- | :--- | :--- |
| **Realm** | A fully separate universe: its own accounts/characters, economy, and central services. Players in different realms never meet (PoE: PC International vs. Xbox vs. China). | 1 for a long time (maybe + a test realm) | The whole server |
| **Gateway / Region** | A location inside a realm where instance servers run. Exists **only for ping**; characters are identical across gateways. | 1 → a handful | Does not exist |
| **Node** | One machine (VPS, cloud VM, Kubernetes node). | 1 → many per gateway | The single dev machine |
| **Instance Server** | A process hosting many instances. Accepts game connections and heartbeats to the orchestrator. | ≈ 1 per CPU core | The single Node process |
| **Instance** | One running copy of a zone, with a unique ID, an owner/access policy, and a lifecycle. | Hundreds per server | `GameWorld` |
| **Zone** (template) | Static definition: map layout, spawns, rules. Instances are created *from* it (PoE calls these *areas*). | Dozens | `ZONES.*` (`ZoneDefinition`) |

### Instance Kinds

| Kind | Who can enter | Examples |
| :--- | :--- | :--- |
| **Private** | Owner + party / invited players | Dungeons, realm runs, hideout |
| **Public (sharded)** | Anyone; players are spread across N copies, each with a player cap | Nexus, towns |

### Instance Lifecycle

```
creating → running → empty (timeout timer) → closed
```

An empty instance is kept alive for a grace period (PoE: ~8 minutes for campaign zones) so players can return, then it is destroyed.

---

## 2. What Runs Alongside the Hierarchy

### Per Realm (central, one location)

| Service | Job |
| :--- | :--- |
| **Account / Login API** | Login, character select, issues session tokens. Stateless HTTP, horizontally scalable. |
| **Database** (Postgres) | Source of truth: accounts, characters, items, stash. |
| **Instance Manager / Orchestrator** | Registry of *instance → server → gateway*; places new instances, issues transfer tickets, tracks server load. The heart of the control plane. |
| **Social Services** | Chat, party, friends, guilds. They span instances, so they cannot live inside one. |
| **Trade / Market** | Anything economic. Requires strict DB transactions. |
| **Message Broker** (Redis / NATS) | Communication layer between services and instance servers: chat fan-out, party events, server heartbeats. Replaces `InMemoryMessageBus`. |
| **Cache / Fast Store** (Redis) | Sessions, character ownership leases, online presence. Often the same Redis as the broker initially. |

### Per Gateway

| Service | Job |
| :--- | :--- |
| **Instance Servers** | See above. The only thing physically close to players. |
| **Ping Endpoint** | Tiny endpoint the client probes to suggest the best gateway. |

### Global (above realms, optional)

| Service | Job |
| :--- | :--- |
| **Website / CDN** | Serves the client build (Vite `dist`) and static assets. |
| **Realm List** | Tells the client which realms and gateways exist. |

### Cross-Cutting

- **Metrics / Logs / Alerts**: tick duration, players per instance, error rates. Required as soon as there is more than one process.

---

## 3. Concepts That Move Between the Pieces

| Term | Meaning |
| :--- | :--- |
| **Account** | The login identity; owns characters. |
| **Character** | Lives in exactly one realm. At any moment it is owned by **at most one instance**. |
| **Session Token** | Signed proof "this is account X" (e.g. JWT). Issued by the Login API, verifiable by any service without a DB lookup. |
| **Transfer Ticket** | Short-lived, signed: "character C may enter instance I on server S". Required to connect to any instance server. |
| **Ownership Lease** | A versioned lock (Redis or DB): "character C is held by instance I". Prevents item duplication. |
| **Handoff** | The zone-change protocol: save → release lease → issue ticket → client reconnects → new instance claims lease. |
| **Party** | A group of players. Private instances are usually owned by a party, not a single player. |
| **Control Plane** | Everything that *decides*: login, orchestrator, tickets. Low traffic, must be correct. |
| **Data Plane** | The 30 Hz game traffic between client and instance server. High traffic, must be low-latency. |

---

## 4. Target Architecture Overview

```
                        ┌───────────── CENTRAL (per realm) ────────────────┐
 Client ──HTTPS login──▶│ Account/Login API ──▶ Postgres (chars, items)     │
                        │ Instance Manager (registry: instance → server)    │
                        │ Chat / Party / Trade services ◀─▶ Redis / NATS    │
                        └───────▲──────────────────────▲────────────────────┘
                                │ control plane        │
             ┌──────────── EU gateway ────────┐  ┌──── US gateway ────┐
 Client ═WS═▶│ instance-server-1 (N instances)│  │ instance-server-7  │
  (data      │ instance-server-2 (N instances)│  │ …                  │
   plane)    └────────────────────────────────┘  └────────────────────┘
```

The **latency-sensitive** part (instance servers) is distributed across gateways. Everything that must be **consistent** (characters, items, trade, chat) is central. A trade or chat message taking an extra 100 ms is fine; a projectile is not.

---

## 5. Walkthrough: One Player Session

1. Client loads from the **CDN** → fetches the **realm list** → pings each **gateway** → picks **EU**.
2. Logs in via the **Login API** → receives a **session token** → selects a character.
3. The **Orchestrator** finds or creates a Nexus **instance** in EU (checking the character's **lease** state) → returns a **ticket** plus the server address.
4. Client opens a WebSocket to that **instance server** → presents the ticket → the instance claims the **lease** → the player spawns.
5. Chat flows through the **broker**; periodic saves go to the **database**.
6. The player enters a portal → **handoff** → new ticket → the client reconnects to another server (possibly another node in the same gateway).

### Zone Transfer in Detail

```
Client ──"enter portal"──▶ current instance server
        instance server ──request──▶ Instance Manager
        Instance Manager:
          - does this party already have a live instance of the target zone? → reuse it
          - otherwise pick a server with capacity and tell it to create one
          - issue a signed, short-lived TRANSFER TICKET
Client ◀──"connect to 10.0.4.17:6112, ticket=abc…"──
Client ──connect + ticket──▶ new instance server
```

This is what a PoE loading screen is. The original RotMG does the same via its `Reconnect` packet (host, port, game ID, key).

**The one-owner rule:** a character must never be live in two instances at once, otherwise items can be duplicated (drop on one server, still hold on the other). The handoff therefore:

1. Freezes the character on server A, persists its state, releases the lease.
2. Server B claims the lease using the ticket, loads state, spawns the character.
3. Any claim that does not match the current lease version is rejected.

---

## 6. Current State vs. Target

Stages 0–5 are complete. A realm runs as several cooperating processes (`pnpm realm:up` starts them in Docker): `account-api` (login, characters), `social` (parties), the `orchestrator` (fleet registry, allocation, the only ticket issuer), the `directory` (realms and their regions), three generic `instance-server`s that host any zone, Postgres, Redis, Prometheus and Grafana. The instance servers are split into two regions, `eu` and `us`; the US region sits behind a simulated 40 ms of distance. Players pick a region by ping. Characters move between servers with the ticket and lease handoff; the orchestrator decides where every new instance runs (within the right region), notices dead servers, and drains servers before they stop. The same realm also runs on a local Kubernetes cluster (`pnpm cluster:up`, Stage 5): a node per region, Agones Fleets of instance servers that scale on free player slots and never remove a server with players, and rolling updates without kicks. Stage 6 moves the databases out of the cluster.

| Concern | Today | Target |
| :--- | :--- | :--- |
| Zone vs. instance | **Done (S1.1–S1.3):** zones (`ZONES`) are templates; instances have ids like `golem_dungeon:7f3a9c` and are created on demand by `InstanceManager` | Instances created on demand from zones |
| Private instances | **Done (S1.3):** one golem dungeon per party (solo players count as a party of one); `portal_bound` zones are supported but unused | Per-party, owned, with timeout |
| Public sharding | **Done (S1.3):** fill-first placement below the soft cap, new shard when all are full, preferred shard up to the hard cap | N Nexus copies with a player cap |
| Instance lifecycle | **Done (S1.4):** a 1 Hz sweeper closes instances empty longer than their zone's timeout (keeping warm hub instances); a tick that throws closes only its own instance and moves its players to the nexus | creating → running → empty → closed |
| Execution | **Stage 2/3:** one instance-server process per container (N containers × 1 process); each process hosts many instances on its main thread; empty instances sleep (no ticks) until someone enters | Many processes/cores, many machines |
| ECS isolation | **Fixed in S1.0:** all `GameWorld`s in a process allocate entity IDs from one shared index (`processEntityIndex`), so the module-global component arrays (`Health.current[eid]`) are never written by two worlds; `destroy()` releases a world's IDs | One shared entity index per process |
| Zone transfer | **Done (S2.8):** every zone change is a handoff (fenced save → release lease → ticket → reconnect → claim), also within one server (decision D4) | Save → release lease → ticket → reconnect → claim |
| Client connection | **Done (S2.6/S2.12):** the client gets a server URL and ticket from `account-api` (which asks the orchestrator), and follows `s2c_reconnect` to whichever server hosts the next instance | Reconnects to whichever server hosts the instance |
| Auth | **Done (S2.3/S2.5/S3.4):** signed session tokens (JWT, HS256) from `account-api`; single-use transfer tickets (30 s, Ed25519) issued only by the orchestrator and verified with its public key by every instance server; refresh secrets stored only as hashes | Signed session token, verifiable anywhere |
| Message bus | **Done (S2.4/S2.10):** Redis pub/sub between services (global and party chat, party updates, kicks); `InMemoryMessageBus` remains for in-process plumbing | Redis / NATS |
| Database | **Done (S1.8):** Postgres via docker-compose, Prisma migrations; tests use Testcontainers | Central Postgres |
| Ownership | **Done (S2.7):** Redis lease plus Postgres fencing epoch per character; newest login wins | One owner per character |
| Placement across servers | **Done (S3.1–S3.5):** the orchestrator applies each zone's access policy across the fleet and creates new instances on the least loaded server (players, instances, tick p95, event loop utilization); registry rebuilt from heartbeats | Load-based, dynamic |
| Server lifecycle | **Done (S3.2/S3.6):** `starting → ready → draining → stopped`, plus `dead` after 6 s without heartbeats; SIGTERM drains (hubs move at once, dungeons get a timeout) | Matches Agones |
| Orchestration | **Done (Stage 5):** a third deployment target, a kind cluster (`infra/k8s`): Deployments for the central services, an Agones Fleet per region (Ready when empty, Allocated with players), a FleetAutoscaler on free player slots, rolling updates that drain old servers, kube-prometheus-stack | Kubernetes + Agones |
| Observability | **Done (S3.7/S4.7):** Prometheus metrics in every service, labelled by region; Grafana "Realm Overview" with a region filter and a Regions row; ticket IDs correlate a handoff across logs | Metrics, dashboards, traces |
| Regions | **Done (Stage 4):** `eu` and `us` in compose (US delayed 40 ms with `tc netem`); the client pings each region's gateway and preselects the fastest; public zones are placed in the player's home region, a party's private instances in the leader's region; no capacity → `region_unavailable`; admission needs 2 central round trips | Gateways |

### Foundations Already in Place

- **Zero-I/O, dependency-free simulation.** A `GameWorld` can run anywhere. This is the hardest property to retrofit.
- **`IWorldRunner`**: the seam for worker threads / separate processes.
- **`IMessageBus`**: the seam for Redis / NATS.
- **Intent-only client** (move, shoot): instance servers are trusted, clients never are.
- **Periodic and on-exit persistence**: a handoff is mostly "persist + release lease".

### Naming Migration

| Current | Target |
| :--- | :--- |
| `GameWorld` / "world" | **Instance** (done in S1.2: `Instance` wraps a `GameWorld`, which now carries `instanceId` and `zoneId`) |
| `ZONES.*` / `ZoneDefinition` (done in S1.1) | **Zone** (template) |
| `WorldCluster` | Renamed to `InstanceHost` in S1.2; later split into **InstanceServer** (hosts instances) + **Orchestrator** (placement, tickets, registry) |

---

## 7. Repository Structure

### The Core Rule: `apps/` vs. `packages/`

- **`apps/`**: things you **deploy**. One app = one Docker image = one container type.
- **`packages/`**: libraries imported by apps. Never deployed on their own.

Three dependency rules:

1. Apps may import packages.
2. Packages never import apps.
3. **Apps never import each other.** They only talk over the network (HTTP, WebSocket, message broker), using shared **contracts**.

Rule 3 is what later allows every app to run in its own container, on its own machine, in its own region.

### Code vs. Deployment Topology

Not every concept in this document is code:

| Concept | Code? | Where it lives |
| :--- | :--- | :--- |
| Account/Login, Orchestrator, Instance Server, Social, Economy, Website, Directory | **Yes**, each is an app | `apps/*` |
| Database, Redis / NATS | **No**, off-the-shelf software we run | `infra/` (compose / k8s manifests) |
| **Realm, Gateway, Node** | **No**, they describe *where and how many* copies run | `infra/environments/*` |

A gateway is "a set of instance-server containers running in Frankfurt, labeled `region=eu`". The instance-server code is identical everywhere.

### Target Layout

```
mmoexile/
├── apps/                          # deployables: one Dockerfile each
│   ├── client/                    # game client (Vite + Three.js + React) → static files on CDN/nginx
│   ├── website/                   # landing page, account page, news (much later)
│   ├── account-api/               # login, session tokens, character list/create/delete
│   ├── orchestrator/              # instance registry, placement, transfer tickets, server heartbeats
│   ├── instance-server/           # hosts N instances, WebSocket data plane, handoff
│   ├── social/                    # chat routing, party, friends, guilds, presence
│   ├── economy/                   # trade, market, stash: anything transactional with items
│   └── directory/                 # realm & gateway list, ping endpoints (tiny, global)
│
├── packages/                      # libraries: never deployed alone
│   ├── game-core/                 # today's `shared`: math, zones/maps, items, prefabs, formulas, ECS components
│   ├── simulation/                # pure GameWorld + systems (zero I/O), extracted from server
│   ├── protocol/                  # client ⇄ instance-server packets (MessagePack)
│   ├── contracts/                 # service ⇄ service: HTTP API schemas, broker subjects & message types
│   ├── auth/                      # sign/verify session tokens & transfer tickets
│   ├── db/                        # Prisma schema, migrations, generated client
│   ├── messaging/                 # broker abstraction + in-memory / Redis (/ NATS) implementations
│   ├── service-kit/               # shared service plumbing: config, logging, /health, metrics, graceful shutdown
│   └── tsconfig/                  # shared TS config presets
│
├── infra/
│   ├── docker/                    # shared Dockerfile base / build helpers
│   ├── compose/                   # docker-compose.yml: postgres, redis, all apps locally
│   ├── k8s/                       # later: Deployments/Services (kustomize or helm)
│   ├── agones/                    # later: Fleet + FleetAutoscaler for instance-server
│   └── environments/              # topology: realm-dev, realm-intl/{gateway-eu, gateway-us}
│
├── tools/                         # load-test bots, seed scripts, admin CLI
├── docs/                          # architecture docs, decision records
├── package.json
├── pnpm-workspace.yaml            # packages: ["apps/*", "packages/*", "tools/*"]
└── turbo.json                     # optional: Turborepo for cached builds/tests across the graph
```

The npm scope becomes `@mmoexile/*` (replacing `@rotmg/*`).

### Where the Original Code Moved (done in Stage 0)

| Before | After |
| :--- | :--- |
| `packages/client` | `apps/client` |
| `packages/shared` | Split into `packages/game-core` + `packages/protocol` |
| `packages/server/src/simulation` | `packages/simulation` (already pure, so it becomes a library) |
| `packages/server/src/gateway` + `cluster` | `apps/instance-server` |
| `packages/server/src/persistence` + `prisma/` | `packages/db` (schema/client) + the services that own the data |
| `packages/server/src/cluster/messaging` | Stays inside `apps/instance-server` (it is in-process plumbing); `packages/messaging` is the *inter-service* broker, introduced in Stage 2 |

Pulling `simulation` into its own package means benchmarks, tests, bots, and potentially client-side prediction can use it without importing a server.

### Inside One App

Every app follows the same skeleton:

```
apps/instance-server/
├── Dockerfile
├── package.json                  # @mmoexile/instance-server
└── src/
    ├── main.ts                   # wiring only: config → dependencies → start
    ├── config.ts                 # env vars, validated (PORT, REGION, ORCHESTRATOR_URL, …)
    ├── host/InstanceHost.ts      # owns many GameWorld instances + their runners
    ├── transport/                # WebSocket endpoint, ticket check on connect
    ├── handoff/                  # lease claim/release, transfer out/in
    ├── clients/orchestrator.ts   # typed client for the orchestrator API (from contracts)
    └── lifecycle/                # Ready / Health / Shutdown, abstracted (Agones SDK later)
```

### Structural Decisions

1. **Contracts are the only shared surface between services.** `packages/contracts` defines e.g. `POST /tickets` or the subject `chat.instance.<id>` with runtime-validated schemas (zod). Changing an API breaks the build of every caller.
2. **One database, strict table ownership.** One Postgres and one `packages/db` schema, but every table has exactly one owning service (account-api: accounts, characters; economy: items, trades; social: friends, guilds). Others ask the owner instead of writing its tables. This keeps a later database split possible and prevents a "distributed monolith".
3. **One multi-stage Dockerfile per app.** Install with pnpm, build only that app plus its package dependencies (`pnpm deploy --filter` or `turbo prune`), copy into a slim runtime image. `docker compose up` runs an entire realm locally.
4. **Only `instance-server` becomes an Agones `GameServer`/`Fleet`.** It is the only stateful, "don't kill me while players are connected" component. Everything else is a plain Kubernetes `Deployment`. Because each server hosts many instances, we use Agones' high-density pattern (Counters/Lists for player and instance counts). The `lifecycle/` abstraction keeps the Agones SDK out of the game code until it is needed.
5. **One process per container (N containers × 1 process).** Node runs JavaScript on one thread, so one instance-server process uses about one CPU core; a 32-core machine runs ~32 instance-server containers rather than one container with 32 worker processes. Unlike stateless HTTP workers (e.g. uvicorn), game processes cannot share a port: each player must reach the specific process hosting their instance, so every process needs its own address and is tracked, drained, and health-checked individually by the orchestrator. Making that unit a container means restarts, deploys, out-of-memory kills, and node failures affect one process and its instances, never a whole group, and it matches Kubernetes/Agones (one `GameServer` per pod). Containers are isolated processes, not VMs, so the overhead is negligible. The instance-server code is identical either way; this is a packaging decision.
6. **Folders appear when their stage arrives.** Empty services rot and obscure what is real. The layout above is the target map, not a scaffold to create up front.

---

## 8. Staged Migration Path

Each stage is independently shippable. The detailed, task-level plan lives in [`SERVER_INFRASTRUCTURE_PLAN.md`](SERVER_INFRASTRUCTURE_PLAN.md).

### Stage 0: Repository Restructure (no behavior change)
- Move today's code into the `apps/` + `packages/` layout, rename the scope to `@mmoexile/*`.

### Stage 1: Real Instancing (single process)
- Split zone templates from instance IDs; add an instance registry.
- Access policies: private (per party) and public (sharded with a cap).
- Empty-instance timeouts and cleanup.
- Move from SQLite to Postgres.

This is mostly game logic and data modeling, and it is what makes the game *feel* instanced.

### Stage 2: Split Process Roles (single machine)
- Separate `api` service (login, character select, tokens, tickets) from `instance-server`.
- Redis for chat, party, and leases.
- Implement the **reconnect-with-ticket handoff** and the **ownership lease**.
- Run two instance-server processes via docker-compose and hand a character between them.

This is the point where it becomes a real distributed system.

### Stage 3: Orchestrator & Fleet
- Instance servers register with the orchestrator and send heartbeats.
- Load-aware placement of new instances; the orchestrator becomes the only ticket issuer.
- Failure handling: a crashed server loses its instances, but characters are safe up to their last save.
- Draining: a server that is told to stop moves its players away first.
- Metrics and a dashboard, so the fleet's load is visible.

### Stage 4: Regions
- Region tag on instance servers.
- Client-side latency probe to suggest a gateway.
- Region-aware placement. Central services stay central.
- The cost of distance to the central services is measured and reduced (fewer round trips per handoff).

### Stage 5: Kubernetes & Agones
- A local kind cluster as an additional deployment target; development and compose stay as they are.
- Plain `Deployment`s for stateless apps; an Agones `Fleet` per region for instance servers, scaled on free player capacity.
- The orchestrator stays the brain (placement, tickets); Agones manages the server processes and never removes a busy one.

### Stage 6: Databases Outside the Cluster
- Postgres and Redis outside the cluster, like managed databases; connection pooling, credentials, backups.

### Stage 7: One Cluster per Region
- A central cluster plus one cluster per region, each with its own Agones; service-to-service authentication across clusters.

Build the pieces by hand first; Kubernetes and Agones make much more sense afterwards.
