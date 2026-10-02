# Server Infrastructure: Implementation Plan

This is the task-level plan for moving from today's single-process server to the target architecture described in [`SERVER_INFRASTRUCTURE.md`](SERVER_INFRASTRUCTURE.md). Read that document first; this one assumes its terminology (realm, gateway, node, instance server, instance, zone, ticket, lease, handoff).

| Stage | Theme | Runs as | New deployables |
| :--- | :--- | :--- | :--- |
| **0** | Repository restructure | 1 process | none (moves only) |
| **1** | Real instancing | 1 process + Postgres | none |
| **2** | Split process roles, handoff | docker-compose, 1 machine | `account-api`, `social`, 2× `instance-server` |
| **3** | Orchestrator & fleet | docker-compose, 1 machine | `orchestrator` |
| 4 | Regions | ≥2 locations | `directory` |
| 5 | Kubernetes & Agones | cluster | none (packaging) |

Stages 0–3 are planned in detail. Stages 4–5 are outlined; they will be detailed once Stage 3 is done and we know what we actually built.

**Working agreements**

- All work happens on the `server-infrastructure` branch (or short-lived branches off it). Each stage ends with every test passing, a playable game, and an updated `SERVER_INFRASTRUCTURE.md` "Current State" table.
- Each task below is intended to be one reviewable commit (or a small group of commits).
- Every stage lists **acceptance criteria**. A stage is not done until they are demonstrated, not just coded.

---

## Stage 0: Repository Restructure

**Goal:** Move today's code into the target `apps/` + `packages/` layout with **zero behavior change**. Everything later builds on these boundaries.

### Target After Stage 0

```
apps/
  client/                 ← packages/client
  instance-server/        ← packages/server (gateway, cluster, persistence; login still lives here until Stage 2)
packages/
  game-core/              ← packages/shared (minus protocol)
  protocol/               ← packages/shared/src/protocol
  simulation/             ← packages/server/src/simulation
  db/                     ← packages/server/prisma + persistence/connection.ts
  tsconfig/               ← tsconfig.base.json presets
docs/                     ← ARCHITECTURE.md, addressing_architecture_critique.md
```

### Tasks

**S0.1 Workspace skeleton**
- `pnpm-workspace.yaml`: `packages: ["apps/*", "packages/*", "tools/*"]`.
- Resolve the `allowBuilds` placeholders (`true` for `@prisma/client`, `@prisma/engines`, `prisma`, `esbuild`).
- Create `packages/tsconfig` with `base.json`, `node.json` (NodeNext), `vite.json` (bundler); replace `tsconfig.base.json`.

**S0.2 Scope rename `@rotmg/*` → `@mmoexile/*`**
- Rename in every `package.json` and import. Mechanical; one commit.

**S0.3 Split `shared` into `game-core` + `protocol`**
- `packages/protocol`: `packets.ts`, `snapshot.ts`, serialization. Depends on `game-core` (for `MapData`, `DamageEvent`).
- `packages/game-core`: everything else (math, maps, items, prefabs, characters, combat, components, voxels).
- `ProjectileState` moves from `protocol/snapshot.ts` to `game-core/combat/projectile.ts`: it is the deterministic projectile description used by the shared shooting formulas, and leaving it in `protocol` would create a `game-core ⇄ protocol` import cycle. `EntityState` (the replication shape) stays in `protocol`.
- Both keep the "source-first" exports (`"main": "./src/index.ts"`), as today, so no build step is needed during development.

**S0.4 Extract `packages/simulation`**
- Move `packages/server/src/simulation/**` to `packages/simulation/src/**`.
- Dependencies: `bitecs`, `@mmoexile/game-core`, `@mmoexile/protocol` (the AOI system builds `EntityState` snapshots; `protocol` is pure types + serialization, so this keeps the simulation I/O-free). **No** `ws`, `prisma`, or Node-only imports (verified by the boundary check in S0.7).
- Move simulation-only tests and `simulation.bench.test.ts` along with it.

**S0.5 Extract `packages/db`**
- Move `prisma/schema.prisma` and `persistence/connection.ts` (the Prisma client singleton) into `packages/db`.
- Repositories, mappers, and `accountService` stay in `apps/instance-server/src/persistence` for now; in Stage 2 they move to their owning services.
- Scripts: `db:generate`, `db:push` (becomes `db:migrate` in Stage 1).

**S0.6 Move apps**
- `packages/client` → `apps/client`, `packages/server` → `apps/instance-server`.
- Root scripts: `dev`, `build`, `test` keep working (`pnpm --filter @mmoexile/instance-server --filter @mmoexile/client dev`).

**S0.7 Dependency boundary check**
- Add `dependency-cruiser` with rules: packages must not import apps; apps must not import other apps; `simulation` must not import `ws`, `@prisma/client`, `node:net`, `node:http`, `node:fs`.
- Root script `pnpm lint:deps`; run it in CI (S0.9).

**S0.8 Documentation cleanup**
- Move `packages/server/ARCHITECTURE.md` and `addressing_architecture_critique.md` into `docs/`; fix the duplicated bullet points in `ARCHITECTURE.md`.
- README: fix the "Worker Threads" claim (not implemented), update paths and scope names.

**S0.9 CI**
- GitHub Actions workflow: `pnpm install --frozen-lockfile`, `pnpm -r build`, `pnpm -r test`, `pnpm lint:deps`.

### Acceptance Criteria
- [x] `pnpm install && pnpm -r build && pnpm -r test` pass from a clean clone.
- [x] `pnpm dev` starts server and client; the game plays exactly as before.
- [x] `pnpm lint:deps` passes and fails if a rule is deliberately violated.
- [x] CI (added in S0.9) is green on GitHub.
- [x] No file under `packages/` imports from `apps/`.

### Out of Scope
Any behavior change, renaming `GameWorld` (Stage 1), Turborepo (revisit when builds get slow).

---

## Stage 1: Real Instancing (single process)

**Goal:** The game *behaves* like an instanced ARPG: zones vs. instances, private per-party dungeons, sharded public hubs, instance lifecycle, parties, Postgres. Still a single process, but with interfaces shaped so Stage 2/3 can swap in distributed implementations.

### S1.0 Prerequisite: Fix ECS Entity-ID Collisions ✅

**Problem (verified):** bitECS components are module-global arrays (e.g. `Health.current[eid]` in `game-core/components`). Every `GameWorld` calls `createWorld()`, which creates its **own** entity index, so two worlds in one process both allocate `eid = 1` and write into the same array slots. This already affects today's 3 worlds and gets worse with hundreds of instances.

**Fix:** One process-wide entity index shared by all worlds (`createEntityIndex()` once, passed into every `createWorld(...)`), so entity IDs are unique across all instances in a process. Isolated worker threads would also fix it, but we are not doing worker threads (see S1.10).

- Add a regression test: two `GameWorld`s, spawn entities in both, assert each world's component values are independent.
- Watch memory: component arrays grow to the highest live eid; the shared index recycles removed eids.

### S1.1 Zone Model (`game-core/zones`)

Replace `STATIC_MAPS` + string world IDs with explicit zone definitions:

```ts
type ZoneId = "nexus" | "realm" | "golem_dungeon";   // extended as content grows

type AccessPolicy =
  | { kind: "public_sharded"; softCap: number; hardCap: number }
  | { kind: "party_private" }
  | { kind: "portal_bound" };          // see Open Decision D1

interface ZoneDefinition {
  id: ZoneId;
  name: string;
  access: AccessPolicy;
  emptyTimeoutSec: number;           // how long an empty instance survives
  minWarmInstances?: number;         // hubs: keep ≥1 alive even when empty
  createMap: () => MapData;
}
```

- Initial policies: `nexus` → `public_sharded` (softCap 40, hardCap 60, timeout 60 s, 1 warm); `realm` → `public_sharded` (softCap 60, hardCap 85); `golem_dungeon` → `party_private` (timeout 480 s).
- Portals reference `targetZoneId` instead of `targetWorldId`. This also fixes the existing mismatch between portal prefabs (`"realm"`, `"golem_dungeon"`) and map definitions (`"realm_1"`, `"dungeon_golem"`).

### S1.2 Instance Identity and Wrapper

- `InstanceId = "<zoneId>:<shortId>"`, e.g. `golem_dungeon:7f3a9c`. Human-readable in logs, globally unique.
- Rename in `apps/instance-server`: `WorldInstance` → `Instance`, `WorldCluster` → `InstanceHost`. `GameWorld` in `packages/simulation` keeps its name (it is the simulation of one instance) but its constructor takes `instanceId`.
- `Instance` holds: `id`, `zone`, `world`, `runner`, `players: Set<CharacterId>`, `ownerPartyId?`, `state`, `createdAt`, `emptySince?`.

### S1.3 `InstanceManager`: Placement Logic

The in-process precursor of the orchestrator. It sits behind an interface so Stage 3 can replace it with a network client:

```ts
interface InstanceDirectory {
  resolve(req: {
    zoneId: ZoneId;
    characterId: CharacterId;
    partyId?: PartyId;
    viaPortalId?: string;
    preferInstanceId?: InstanceId;     // e.g. "join my party member's town"
  }): Instance;                         // existing or newly created
}
```

Rules:

- **`public_sharded`**: if `preferInstanceId` is valid and below `hardCap`, use it (joining friends). Otherwise **fill-first**: choose the most populated instance still below `softCap`. If none, create a new one.
- **`party_private`**: key = `(zoneId, partyId ?? soloPartyOf(characterId))`. Reuse if alive, otherwise create.
- **`portal_bound`**: key = portal entity ID; the instance is created on first entry, shared by everyone who uses that portal.

### S1.4 Instance Lifecycle

- States: `creating → running → empty → closed` (plus `crashed`, see fault isolation below).
- A sweeper (1 Hz, outside the tick loop) closes instances whose `emptySince + emptyTimeoutSec` has passed, except to keep `minWarmInstances`.
- Closing stops the runner, destroys the world, and frees its entity IDs back to the shared index.
- Uses an injectable clock so lifecycle tests run instantly.
- **Per-instance fault isolation:** each instance's tick runs inside its own error boundary. If a tick throws, only that instance is closed (state `crashed`, logged with its instance ID and zone): its players' last good state is saved and they are moved to a nexus shard with a system message. All other instances in the process keep running. A failure inside the host itself (outside any tick) still crashes the process, which is what the container restart is for.

### S1.5 Parties (minimal)

- In-process `PartyService` in `apps/instance-server/src/party/` (moves to the `social` app in Stage 2).
- Chat commands for now (no UI work): `/invite <name>`, `/accept`, `/leave`, `/party` (list).
- A new packet `s2c_party_update { partyId, members[] }` so the HUD can show members later.
- Max party size: 6 (configurable).

### S1.6 Transfers Through the Directory

- `transferPlayer(characterId, target: { zoneId, viaPortalId? })` → `InstanceManager.resolve(...)` → move the character.
- **Character snapshot:** introduce one function, `snapshotCharacter(world, characterId) → CharacterState`, used for transfers, saves, and (in Stage 2) handoffs. It replaces the hand-built `SpawnPlayerOptions` in `transferPlayer`, which today hard-codes `mp: 100`.
- `s2c_world_transfer` → `s2c_instance_transfer { instanceId, zoneId, map, spawnX, spawnY }`.

### S1.7 Chat Scopes

- Default chat is **instance-local** (like RotMG); `/g <text>` for global; `/p <text>` for party.
- System messages scoped correctly: level-ups → instance, deaths → global, "entered zone" → target instance only.

### S1.8 Postgres

- `infra/compose/docker-compose.yml` with **only** Postgres (first piece of infra); `.env.example` with `DATABASE_URL`.
- Prisma provider → `postgresql`; move from `db push` to `prisma migrate` with a committed initial migration.
- Schema changes: `Character.currentWorld` → `lastZoneId`; `inventory` → `Json`.
- Tests: a separate database schema per test run (or a Postgres testcontainer); document `pnpm db:test:reset`.

### S1.9 Login Destination

- On login, characters always spawn in a **nexus shard**, never directly into a private instance (PoE sends you to town after a disconnect). Keeps "rejoin a still-alive dungeon" as a later feature.

### S1.10 Explicit Non-Goal: Worker Threads

We scale by running **more instance-server processes** (Stage 2+), not threads inside one process. This matches the one-process-per-container model of Docker/Kubernetes/Agones and avoids a second concurrency model. `IWorldRunner` stays, but `InProcessWorldRunner` remains the only implementation.

### S1.11 Introspection

- `GET /health` includes instance count and player count.
- `GET /debug/instances` (dev only): list of instances with zone, players, state, age.

### Tests
- Unit: `InstanceManager` rules per policy (fill-first, caps, party reuse, portal binding).
- Unit: lifecycle with fake clock (timeouts, warm minimum).
- Integration: two solo players entering the dungeon get **different** instances; after `/invite` + `/accept` they get the **same** one.
- Integration: `softCap + 1` players in nexus → a second shard exists.
- Regression: ECS isolation (S1.0); transfer preserves full state including MP.
- Fault isolation: an instance whose tick throws is closed and its players land in the nexus, while a second instance in the same process keeps ticking.

### Acceptance Criteria
- [ ] Two browser tabs, not partied → separate golem dungeons (each sees only their own monsters).
- [ ] Same two tabs after partying → the same dungeon instance.
- [ ] Leaving a dungeon empty for the timeout → `/debug/instances` shows it closed.
- [ ] A bot script filling the nexus beyond `softCap` creates a second shard.
- [ ] The game runs on Postgres via docker-compose; SQLite is gone.
- [ ] All tests and the benchmark (100 players / 500 monsters) still pass.

---

## Stage 2: Split Process Roles & Handoff

**Goal:** A realm made of several cooperating processes on one machine, via docker-compose. Login leaves the game server; characters move **between instance servers** safely via tickets and ownership leases. This is the stage where the system becomes truly distributed.

### Target Topology (docker-compose)

| Service | Port | Image | Role |
| :--- | :--- | :--- | :--- |
| `postgres` | 5432 | postgres:16 | Source of truth |
| `redis` | 6379 | redis:7 | Broker (pub/sub), leases, presence, ticket replay protection |
| `account-api` | 3000 | `apps/account-api` | Login, characters, first ticket |
| `social` | 3002 | `apps/social` | Parties, chat moderation, presence queries |
| `instance-server-a` | 7001 | `apps/instance-server` | Hosts `nexus` |
| `instance-server-b` | 7002 | `apps/instance-server` | Hosts `realm` and `golem_dungeon` |
| `client` | 8080 | nginx + `apps/client/dist` | Static client, proxies `/api` to account-api |

**Static placement:** in Stage 2, which server hosts which zone is a config table (`ZONE_PLACEMENT=nexus:a,realm:b,golem_dungeon:b`). This is the classic "zone server" model of older MMOs and a deliberate stepping stone: it gives us real cross-server handoffs without an orchestrator. The **target server** resolves the concrete instance (it runs its own `InstanceManager` from Stage 1).

### S2.1 `packages/service-kit`
- Env config loading + validation (zod), structured logging (pino), `/health` + `/ready` endpoints, graceful shutdown hooks, request/correlation IDs.
- Every app's `main.ts` uses it, so all services behave identically operationally.

### S2.2 `packages/contracts`
- zod schemas + TS types for: account-api HTTP API, social HTTP API, instance-server internal API, and **broker subjects** (`chat.global`, `chat.party.<partyId>`, `chat.whisper.<characterId>`, `party.updated.<partyId>`, `session.kick.<characterId>`).
- Typed HTTP client helpers generated from these schemas.

### S2.3 `packages/auth`
- **Session token:** JWT (`jose`), `{ sub: accountId, exp: 24h }`, issued by account-api.
- **Transfer ticket:** JWT, `{ jti, characterId, accountId, zoneId, partyId?, viaPortalId?, targetServerId, exp: 30s }`.
- Signing: shared HMAC secret in Stage 2 (all trusted services hold it). Stage 3 switches tickets to Ed25519 so instance servers only hold the public key.
- Replay protection: `jti` claimed once via Redis `SET ticket:<jti> 1 NX EX 60`.

### S2.4 `packages/messaging`
- `Broker` interface: `publish(subject, msg)`, `subscribe(subject, handler)`, pattern subscriptions; typed by `contracts`.
- Implementations: `InMemoryBroker` (tests), `RedisBroker` (ioredis pub/sub).
- Redis is chosen over NATS for now because we need Redis anyway (leases, presence). The interface keeps NATS possible later.

### S2.5 `apps/account-api`
- Framework: Fastify.
- Owns tables: `Account`, `Character` (create/delete/list; gameplay-state columns are written by the lease holder, see S2.7).
- Endpoints:
  - `POST /auth/guest { nickname }` → creates account, returns `{ sessionToken, refreshSecret }` (the client stores the refresh secret like today's localStorage token).
  - `POST /auth/refresh { refreshSecret }` → new session token.
  - `GET /characters`, `POST /characters { classId }`, `DELETE /characters/:id`.
  - `POST /play { characterId }` → `{ url, ticket }` for the character's nexus server (static placement).
- Multiple characters per account (character select screen in the client).
- Moves `accountService`, repositories, and mappers out of the instance server; the instance server keeps only a slim character-state repository.

### S2.6 Protocol Changes (`packages/protocol`)
- Remove `c2s_join` (login is HTTP now).
- `c2s_hello { ticket, clientVersion }`: the first packet on every connection.
- `s2c_welcome` loses `token`.
- `s2c_reconnect { url, ticket, zoneId }`: "go connect over there".
- `s2c_kicked { reason: "logged_in_elsewhere" | "server_shutdown" | "invalid_ticket" | "version_mismatch" }`.
- `PROTOCOL_VERSION` constant checked in `c2s_hello`.

### S2.7 Ownership Lease + Fencing
- **Lease** in Redis: `lease:char:<id> = { serverId, instanceId, epoch }`, `SET NX PX 30000`, renewed every 10 s by the holding server.
- **Fencing epoch** in Postgres: new column `Character.ownerEpoch`. Acquiring a lease increments it (`UPDATE … SET ownerEpoch = ownerEpoch + 1 RETURNING ownerEpoch`).
- **Every state write is conditional:** `UPDATE Character SET … WHERE id = $1 AND ownerEpoch = $2`. A server that lost its lease (GC pause, network split) can no longer overwrite newer data. Its write affects 0 rows, which it treats as "I've been fenced": it drops the character and disconnects the client.
- Lease renewal failure → same as fenced.

This lease-plus-fencing pattern is the core anti-duplication mechanism. It deserves careful tests (S2 Tests).

### S2.8 Handoff Protocol

```
Server A (source)                          Client                       Server B (target)
─────────────────                          ──────                       ─────────────────
1. portal used → freeze character
   (stop processing its commands)
2. final save WHERE ownerEpoch = e
3. release lease (DEL if still ours)
4. sign ticket {zone, party, target=B}
5. s2c_reconnect {url_B, ticket} ────────▶ 6. show loading screen,
                                              close socket to A,
                                              open socket to B
                                           7. c2s_hello {ticket} ───────▶ 8. verify signature, exp, target=B
                                                                          9. claim jti (replay protection)
                                                                         10. acquire lease → epoch e+1
                                                                         11. load character from Postgres
                                                                         12. InstanceManager.resolve(zone, party)
                                                                         13. spawn, s2c_welcome
```

**Failure cases and outcomes:**

| Failure | Outcome |
| :--- | :--- |
| Client never arrives at B | Ticket expires after 30 s; character is saved and simply offline. Next login works normally. |
| A crashes before step 2 | Lease expires after ≤30 s; progress since the last periodic save (≤5 s) is lost. |
| Ticket replayed / used twice | Second `jti` claim fails → `s2c_kicked(invalid_ticket)`. |
| A writes late after releasing | Fenced by `ownerEpoch` → write rejected. |
| B cannot acquire lease (someone else holds it) | Treat as "logged in elsewhere" (S2.9). |

**Same-server transfers** use the **same protocol**, including the reconnect. One code path is easier to reason about and test. A fast path that skips the reconnect can come later as an optimization, once the general path is proven.

### S2.9 Duplicate Login Policy: "Newest Login Wins"
- A new ticket for a character whose lease is held → the claiming server publishes `session.kick.<characterId>`. The holder saves, releases, and sends `s2c_kicked(logged_in_elsewhere)`. The claimer retries the lease for up to 5 s; if that fails, it force-takes by bumping the epoch (the old holder is then fenced).

### S2.10 `apps/social`
- Owns parties (moved from the Stage 1 in-process `PartyService`), stored in Redis (parties are ephemeral).
- HTTP API for party operations (called by instance servers when players type `/invite` etc.).
- Publishes `party.updated.<partyId>`; instance servers forward it to affected clients as `s2c_party_update`.
- **Chat routing stays on the broker:** instance servers publish player messages to `chat.global` / `chat.party.<id>` and subscribe to the subjects relevant to their connected players. Instance-local chat never leaves the instance server. `social` adds rate limiting and mute lists on top.
- **Presence:** `presence:<characterId> = { serverId, instanceId, zoneId }` in Redis (written by the lease holder), used for whispers and "join party member".

The client keeps **one** connection (to its current instance server). Social features flow through it; the client never talks to `social` directly.

### S2.11 `apps/instance-server` Changes
- Accepts connections only with valid tickets; no more login logic.
- Periodic saves use the fenced write; the shutdown flush (existing logic) becomes "save + release all leases + `s2c_kicked(server_shutdown)`".
- Internal HTTP (not exposed publicly): `GET /internal/status` for debugging.

### S2.12 Client Changes
- Login / character-select screens talk to `account-api` over HTTP.
- `NetworkManager` supports `reconnect(url, ticket)`: tear down the socket, show a loading screen, connect, send `c2s_hello`, wait for `s2c_welcome`, and replace world state.
- Handles `s2c_kicked` with a clear message.

### S2.13 Docker
- `infra/docker/node.Dockerfile`: shared multi-stage template (pnpm fetch → `pnpm deploy --filter <app> --prod` → `node:22-slim` runtime, non-root user).
- One thin `Dockerfile` per app, or build args on the shared template.
- `infra/compose/docker-compose.yml`: the full topology above, with healthchecks and `depends_on: condition: service_healthy`.
- `pnpm realm:up` / `pnpm realm:down` convenience scripts.

### Tests
- Unit: ticket sign/verify/expiry/replay; lease acquire/renew/expire; fenced write rejects a stale epoch.
- Integration (in-process, no Docker): two `InstanceServer` instances + `InMemoryBroker` + in-memory lease store + test Postgres. Portal on A → character appears on B with identical state; A can no longer write.
- Chaos-style integration: kill A mid-handoff (before and after step 2) → no duplication, bounded progress loss.
- `tools/bots`: headless bot client (uses `protocol` + the account-api HTTP client) that logs in, walks, and uses portals. Used for e2e against docker-compose.

### Acceptance Criteria
- [ ] `pnpm realm:up` brings up the full topology; the game is playable at `http://localhost:8080`.
- [ ] Entering the realm portal visibly reconnects from server A to server B (loading screen, server ID in the debug overlay), with HP/MP/XP/inventory preserved.
- [ ] Logging into the same character in a second tab kicks the first tab.
- [ ] `docker kill instance-server-b` while in the dungeon → the player gets disconnected; logging in again works after ≤30 s and loses ≤5 s of progress; no duplicated items.
- [ ] Global chat and party chat reach players on both servers.
- [ ] A bot run of 50 bots hopping between zones for 10 minutes ends with zero lease or fencing errors in the logs.

---

## Stage 3: Orchestrator & Fleet

**Goal:** Replace static placement with a dynamic orchestrator. Instance servers become interchangeable; new instances are placed by load; dead servers are detected; servers can be drained.

### S3.1 `apps/orchestrator`
- Owns the **instance registry**: `serverId → { url, region, capacity, load, state }` and `instanceId → { serverId, zoneId, partyId?, players, state }`.
- The registry lives in orchestrator memory, mirrored to Redis. It is **rebuildable**: after an orchestrator restart, instance servers re-register and re-report their instances on the next heartbeat. The orchestrator is a single process for now (a known single point of failure; leader election comes much later, if ever).

### S3.2 Server Registration & Heartbeats
- On startup the instance server calls `POST /servers/register { serverId, url, region, capacity }` and then enters `ready`.
- Every 2 s: `POST /servers/:id/heartbeat { instances: [{ id, zoneId, partyId, players, state }], tickP95Ms, cpu }`.
- Missed 3 heartbeats (6 s) → server marked `dead`: excluded from placement, its instances dropped from the registry. The instance-server lifecycle states `starting → ready → draining → stopped` map 1:1 onto Agones later.

### S3.3 Allocation API
- `POST /allocate { zoneId, characterId, partyId?, viaPortalId?, preferInstanceId? }` → `{ url, ticket, instanceId }`.
- Runs the Stage 1 `InstanceManager` rules **globally** (across servers): reuse an existing instance where the policy allows, otherwise choose a server and call its internal `POST /internal/instances { instanceId, zoneId, partyId? }`.
- **Placement score:** exclude `draining`/`dead`/over-capacity servers; prefer the lowest `players + instances × weight`, penalize high `tickP95Ms`. Simple, observable, replaceable.
- Tickets now carry `instanceId` (the target server no longer resolves instances itself).

### S3.4 Ticket Issuance Moves to the Orchestrator
- Ed25519 signing key lives only in the orchestrator (and account-api for the first login, or account-api calls `/allocate`: preferred, single issuer).
- Instance servers get only the public key. A compromised instance server cannot mint tickets.

### S3.5 Instance Servers Become Generic
- Remove `ZONE_PLACEMENT`; any server can host any zone.
- Portal use → `POST /allocate` → handoff (Stage 2 protocol, unchanged).
- Report instance lifecycle changes (created/closed/player count) in heartbeats plus immediate events for creation/closure.

### S3.6 Draining
- `SIGTERM` or `POST /servers/:id/drain` → the server enters `draining`: no new allocations.
- Public hub instances: players are handed off to other shards of the same zone (handoff protocol, `preferInstanceId` unset).
- Private instances: continue until empty or until `drainTimeoutSec` (e.g. 10 min), then remaining players are handed off to a nexus shard.
- When empty → `stopped` → process exits. This is exactly the behavior Agones expects from a game server.

### S3.7 Observability
- `service-kit` exposes Prometheus metrics: players, instances, tick duration histogram, handoff duration, lease conflicts, fenced writes, allocation latency, ticket rejections.
- docker-compose adds Prometheus + Grafana with one provisioned "Realm Overview" dashboard.
- Correlation: the ticket `jti` appears in the logs of every service involved in a handoff.

### S3.8 Scaling Locally
- docker-compose defines `instance-server-1..3` explicitly (each needs its own published port for direct client connections).
- Documented experiment: start with 1, add 2 more, watch placement spread new instances; drain one, watch players move.

### Tests
- Unit: placement scoring; registry rebuild from heartbeats; dead-server detection with fake clock.
- Integration: 3 in-process instance servers + orchestrator; allocate 60 dungeon instances → spread across servers within ±20%.
- Integration: drain a server with 10 hub players → all end up on other servers with state intact.
- Load: `tools/bots` with 300 bots over 3 servers for 15 minutes; tick p95 stays below 33 ms on every server.

### Acceptance Criteria
- [ ] No static zone placement remains; any server hosts any zone.
- [ ] Killing a server: the orchestrator marks it dead within 10 s; no new instances land there; affected players can log back in.
- [ ] Draining a server moves its hub players away without data loss and the process then exits cleanly.
- [ ] Restarting the orchestrator does not disconnect any player; the registry is rebuilt within one heartbeat interval.
- [ ] The Grafana dashboard shows per-server players, instances, and tick times during a bot run.

---

## Stage 4: Regions (outline)

- `apps/directory`: realm list + gateway list `{ region, pingUrl }`; tiny, stateless, global.
- Instance servers get a `REGION` label; the orchestrator filters placement by region.
- Client: on the login screen, ping each gateway's `pingUrl` (WebSocket or HTTP round-trips, median of 5), preselect the fastest; the choice is sent with `/play` and stored per account.
- Party rule: a party's private instances are placed in the **party leader's** region.
- Central services (account-api, orchestrator, social, Postgres, Redis) stay in one location. Handoffs cost one cross-region round trip for the lease; periodic saves are async, so this is acceptable.
- Local simulation: two compose "regions" with injected latency (`tc netem`) to feel the effect.

## Stage 5: Kubernetes & Agones (outline)

- Stateless apps (account-api, social, orchestrator, directory, client) → Kubernetes `Deployment` + `Service` + `Ingress`.
- `instance-server` → Agones `Fleet` with Counters (`players`, `instances`) for high-density allocation; `FleetAutoscaler` on buffer capacity.
- The instance-server `lifecycle/` adapter calls the Agones SDK (`Ready`, `Health`, `Shutdown`, counter updates) instead of the orchestrator heartbeat for liveness; the orchestrator allocates via the Agones allocator.
- Local cluster with `kind` or `k3d`, manifests under `infra/k8s` (kustomize) and `infra/agones`.
- Managed Postgres/Redis in production; secrets via Kubernetes Secrets.

---

## Cross-Cutting Concerns

### Ports & Naming Conventions

| Service | Dev port | Env prefix |
| :--- | :--- | :--- |
| client (Vite dev) | 5173 | `VITE_` |
| account-api | 3000 | `ACCOUNT_API_` |
| social | 3002 | `SOCIAL_` |
| orchestrator | 3003 | `ORCHESTRATOR_` |
| instance-server | 7001+ | `INSTANCE_SERVER_` |
| postgres / redis | 5432 / 6379 | `DATABASE_URL` / `REDIS_URL` |

### Security Baseline (grows per stage)
- Clients are never trusted (already true); instance servers only trust tickets; internal endpoints are not exposed publicly.
- Rate limits on login and chat; payload size limits on WebSocket messages.
- Secrets only via environment variables; `.env.example` committed, `.env` ignored.

### Testing Pyramid
- Unit tests next to the code in each package/app.
- Multi-service integration tests run **in-process** with in-memory broker/lease implementations (fast, no Docker).
- A small e2e suite with `tools/bots` against docker-compose, run manually and before merging each stage.

---

## Open Decisions

Decide these when the relevant stage starts; the plan above uses the **bold** default.

| # | Decision | Options | Default |
| :--- | :--- | :--- | :--- |
| D1 | Dungeon access model | **PoE-style `party_private`** vs. RotMG-style `portal_bound` (a boss drops a portal; everyone who enters shares that instance) | `party_private` for the golem dungeon; `portal_bound` available for future realm dungeons |
| D2 | HTTP framework | **Fastify** vs. Hono vs. Express | Fastify |
| D3 | Broker | **Redis** vs. NATS | Redis (needed anyway for leases) |
| D4 | Same-server transfer fast path | **Always reconnect** vs. skip reconnect when target is local | Always reconnect until Stage 3 is done, then optimize |
| D5 | Build orchestration | Plain `pnpm -r` vs. Turborepo | `pnpm -r`; adopt Turborepo when builds get slow |
| D6 | Characters per account | **Multiple** vs. one active | Multiple, from Stage 2 |
| D7 | Postgres in tests | Separate schema per run vs. **testcontainers** | Testcontainers if Docker is available, schema-per-run fallback |
