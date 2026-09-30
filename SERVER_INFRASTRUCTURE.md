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
| **Zone** (template) | Static definition: map layout, spawns, rules. Instances are created *from* it (PoE calls these *areas*). | Dozens | `STATIC_MAPS.*` |

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

Today, everything runs in **one Node process** (`packages/server/src/index.ts`): HTTP, WebSocket gateway, `WorldCluster`, all worlds, and persistence.

| Concern | Today | Target |
| :--- | :--- | :--- |
| Zone vs. instance | Conflated: three hard-coded worlds (`nexus`, `realm_1`, `dungeon_golem`) created at startup | Instances created on demand from zones |
| Private instances | None; every player shares the same golem dungeon | Per-party, owned, with timeout |
| Public sharding | One Nexus for everyone | N Nexus copies with a player cap |
| Instance lifecycle | Worlds live forever | creating → running → empty → closed |
| Execution | Only `InProcessWorldRunner`; all worlds tick on the main thread (worker threads are not yet implemented) | Many processes/cores, many machines |
| Zone transfer | In-memory function call (`WorldCluster.transferPlayer`) | Save → release lease → ticket → reconnect → claim |
| Client connection | One fixed `ws://host:3001/ws` for the whole session | Reconnects to whichever server hosts the instance |
| Auth | Token stored in DB, looked up by the gateway | Signed session token, verifiable anywhere |
| Message bus | `InMemoryMessageBus` | Redis / NATS |
| Database | SQLite file | Central Postgres |
| Regions | None | Gateways |

### Foundations Already in Place

- **Zero-I/O, dependency-free simulation.** A `GameWorld` can run anywhere. This is the hardest property to retrofit.
- **`IWorldRunner`**: the seam for worker threads / separate processes.
- **`IMessageBus`**: the seam for Redis / NATS.
- **Intent-only client** (move, shoot): instance servers are trusted, clients never are.
- **Periodic and on-exit persistence**: a handoff is mostly "persist + release lease".

### Naming Migration

| Current | Target |
| :--- | :--- |
| `GameWorld` / "world" | **Instance** |
| `STATIC_MAPS.*` / `MapData` | **Zone** (template) |
| `WorldCluster` | Split into **InstanceServer** (hosts instances) + **Orchestrator** (placement, tickets, registry) |

---

## 7. Staged Migration Path

Each stage is independently shippable.

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
- Load-aware placement of new instances.
- Failure handling: a crashed server loses its instances, but characters are safe up to their last save.

### Stage 4: Regions
- Region tag on instance servers.
- Client-side latency probe to suggest a gateway.
- Region-aware placement. Central services stay central.

### Later Tooling (not needed yet)
Docker, Kubernetes, and **Agones** (Kubernetes for game servers: fleets, allocation, player counts). Build the pieces by hand first; these tools make much more sense afterwards.
