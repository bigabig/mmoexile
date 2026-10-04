# Server Infrastructure: Implementation Plan

This is the task-level plan for moving from today's single-process server to the target architecture described in [`SERVER_INFRASTRUCTURE.md`](SERVER_INFRASTRUCTURE.md). Read that document first; this one assumes its terminology (realm, gateway, node, instance server, instance, zone, ticket, lease, handoff).

| Stage | Theme | Runs as | New deployables |
| :--- | :--- | :--- | :--- |
| **0** | Repository restructure | 1 process | none (moves only) |
| **1** | Real instancing | 1 process + Postgres | none |
| **2** | Split process roles, handoff | docker-compose, 1 machine | `account-api`, `social`, 2× `instance-server` |
| **3** | Orchestrator & fleet | docker-compose, 1 machine | `orchestrator`, 3× generic `instance-server`, Prometheus, Grafana |
| 4 | Regions | ≥2 locations | `directory` |
| 5 | Kubernetes & Agones | cluster | none (packaging) |

Stages 0–3 are done (each with implementation notes and verified acceptance criteria below). Stage 4 is planned in detail; Stage 5 is outlined.

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

### S1.1 Zone Model (`game-core/zones`) ✅

Replace `STATIC_MAPS` + string world IDs with explicit zone definitions:

```ts
type ZoneId = "nexus" | "overworld" | "golem_dungeon";   // extended as content grows

type AccessPolicy =
  | { kind: "public_sharded"; softCap: number; hardCap: number }
  | { kind: "party_private" }
  | { kind: "portal_bound" };          // see Decision D1

interface ZoneDefinition {
  id: ZoneId;
  name: string;
  access: AccessPolicy;
  emptyTimeoutSec: number;           // how long an empty instance survives
  minWarmInstances?: number;         // hubs: keep ≥1 alive even when empty
  createMap: () => MapData;
}
```

- Initial policies: `nexus` → `public_sharded` (softCap 40, hardCap 60, timeout 60 s, 1 warm); `overworld` → `public_sharded` (softCap 60, hardCap 85, timeout 300 s); `golem_dungeon` → `party_private` (timeout 480 s).
- Portals reference `targetZoneId` instead of `targetWorldId`. This also fixes the existing mismatch between portal prefabs (`"realm"`, `"golem_dungeon"`) and map definitions (`"realm_1"`, `"dungeon_golem"`).

### S1.2 Instance Identity and Wrapper ✅

- `InstanceId = "<zoneId>:<shortId>"`, e.g. `golem_dungeon:7f3a9c`. Human-readable in logs, globally unique.
- Rename in `apps/instance-server`: `WorldInstance` → `Instance`, `WorldCluster` → `InstanceHost`. `GameWorld` in `packages/simulation` keeps its name (it is the simulation of one instance) but its constructor takes `instanceId`.
- `Instance` holds: `id`, `zone`, `world`, `runner`, `players: Set<CharacterId>`, `ownerPartyId?`, `state`, `createdAt`, `emptySince?`.

### S1.3 `InstanceManager`: Placement Logic ✅

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
- **`portal_bound`**: key = `<sourceInstanceId>/<portalId>` (portal IDs come from map definitions, so they repeat across instances of the same zone); the instance is created on first entry, shared by everyone who uses that portal. Entering without a portal is refused.
- Login only honors public zones; a character whose saved zone is private or portal-bound logs into the nexus (part of S1.9).

### S1.4 Instance Lifecycle ✅

- States: `creating → running → empty → closed` (plus `crashed`, see fault isolation below).
- A sweeper (1 Hz, outside the tick loop) closes instances whose `emptySince + emptyTimeoutSec` has passed, except to keep `minWarmInstances`.
- Closing stops the runner, destroys the world, and frees its entity IDs back to the shared index.
- Uses an injectable clock so lifecycle tests run instantly.
- **Per-instance fault isolation:** each instance's tick runs inside its own error boundary. If a tick throws, only that instance is closed (state `crashed`, logged with its instance ID and zone): its players' last good state is saved and they are moved to a nexus shard with a system message. All other instances in the process keep running. A failure inside the host itself (outside any tick) still crashes the process, which is what the container restart is for.

### S1.5 Parties (minimal) ✅

- In-process `PartyService` in `apps/instance-server/src/party/` (moves to the `social` app in Stage 2).
- Chat commands for now (no UI work): `/invite <name>`, `/accept`, `/leave`, `/party` (list).
- A new packet `s2c_party_update { partyId, members[] }` so the HUD can show members later.
- Max party size: 6 (configurable). Invites expire after 60 s; the leader role passes to the next member; a party of one is disbanded.
- Disconnecting leaves the party (until parties move to the `social` service in Stage 2).

### S1.6 Transfers Through the Directory ✅

- `transferPlayer(characterId, target: { zoneId, viaPortalId? })` → `InstanceManager.resolve(...)` → move the character.
- **Character snapshot:** introduce one function, `snapshotCharacter(world, characterId) → CharacterSnapshot`, used for transfers, saves, and (in Stage 2) handoffs. It replaces the hand-built `SpawnPlayerOptions` in `transferPlayer`.
- Correction found while implementing: MP is not simulated at all (no mana component; the `mp` spawn option is ignored). The bug was that every save wrote `mp: 100`. Snapshots now omit MP so the stored value is untouched until a mana system exists.
- Removed the unused in-tick `player_state_persist` event (it ran `JSON.stringify` inside the tick every 150 ticks with no listener).
- `s2c_world_transfer` → `s2c_instance_transfer { instanceId, zoneId, map, spawnX, spawnY }`.

### S1.7 Chat Scopes ✅

- Default chat is **instance-local** (like RotMG); `/g <text>` for global; `/p <text>` for party.
- System messages scoped correctly: level-ups → instance, deaths → global, "entered zone" → target instance only.
- `s2c_chat` carries a `channel` (`local` / `global` / `party`); the client prefixes global and party messages. Command replies are private `local` system messages.

### S1.8 Postgres ✅

- `infra/compose/docker-compose.yml` with **only** Postgres (first piece of infra); `.env.example` with `DATABASE_URL`.
- Prisma provider → `postgresql`; move from `db push` to `prisma migrate` with a committed initial migration.
- Schema changes: `Character.currentWorld` → `lastZoneId`; `inventory` → `Json`.
- Tests: a throwaway Postgres container per test run via Testcontainers (Decision D7), or `TEST_DATABASE_URL` to use an existing database. No manual reset needed.
- Local dev needs no configuration: `@mmoexile/db` falls back to the compose database URL when `DATABASE_URL` is unset. Root scripts: `db:up`, `db:down`, `db:migrate`, `db:deploy`.

### S1.9 Login Destination ✅

- On login, characters always spawn in a **nexus shard**, never directly into a private instance (PoE sends you to town after a disconnect). Keeps "rejoin a still-alive dungeon" as a later feature.
- The policy lives in the login flow (gateway); `InstanceHost.registerPlayer` additionally refuses non-public zones as a safety net.

### S1.10 Explicit Non-Goal: Worker Threads ✅

We scale by running **more instance-server processes** (Stage 2+), not threads inside one process. This matches the one-process-per-container model of Docker/Kubernetes/Agones and avoids a second concurrency model. `IWorldRunner` stays, but `InProcessWorldRunner` remains the only implementation.

### S1.11 Introspection ✅

- `GET /health` includes instance count and player count.
- `GET /debug/instances` (dev only): list of instances with zone, players, state, age.
- Routes live in `src/http.ts`; `/debug/*` is enabled unless `NODE_ENV=production`.

### Tests
- Unit: `InstanceManager` rules per policy (fill-first, caps, party reuse, portal binding).
- Unit: lifecycle with fake clock (timeouts, warm minimum).
- Integration: two solo players entering the dungeon get **different** instances; after `/invite` + `/accept` they get the **same** one.
- Integration: `softCap + 1` players in nexus → a second shard exists.
- Regression: ECS isolation (S1.0); transfer preserves full state including MP.
- Fault isolation: an instance whose tick throws is closed and its players land in the nexus, while a second instance in the same process keeps ticking.

### Acceptance Criteria
- [x] Two browser tabs, not partied → separate golem dungeons (each sees only their own monsters). *Verified with two protocol-level bots that pathfind through the maps (`golem_dungeon:682b69` vs `:468793`).*
- [x] Same two tabs after partying → the same dungeon instance. *Verified with two bots partying via `/invite` + `/accept` (both in `golem_dungeon:f73165`).*
- [x] Leaving a dungeon empty for the timeout → `/debug/instances` shows it closed. *Closed instances are removed from the list. Covered by lifecycle tests, including the real sweeper timer; not waited out live (8 min).*
- [x] A bot script filling the nexus beyond `softCap` creates a second shard. *41 bots → `nexus:c11cb4` with 40 players and `nexus:aa7587` with 1.*
- [x] The game runs on Postgres via docker-compose; SQLite is gone.
- [x] All tests and the benchmark (100 players / 500 monsters) still pass. *108 tests; benchmark avg 11.9 ms / p95 15.5 ms per tick.*

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
| `instance-server-b` | 7002 | `apps/instance-server` | Hosts `overworld` and `golem_dungeon` |
| `client` | 8080 | nginx + `apps/client/dist` | Static client, proxies `/api` to account-api |

**Static placement:** in Stage 2, which server hosts which zone is a config table (`ZONE_PLACEMENT=nexus:a,overworld:b,golem_dungeon:b`). This is the classic "zone server" model of older MMOs and a deliberate stepping stone: it gives us real cross-server handoffs without an orchestrator. The **target server** resolves the concrete instance (it runs its own `InstanceManager` from Stage 1).

### S2.1 `packages/service-kit` ✅
- Env config loading + validation (zod), structured logging (pino), `/health` + `/ready` endpoints, graceful shutdown hooks, request/correlation IDs.
- Every app's `main.ts` uses it, so all services behave identically operationally.
- Implemented as `loadConfig` (zod), `createLogger` (pino), `createHttpService` (Fastify with zod validators, `x-request-id`, `/health`, `/ready`) and `handleShutdownSignals`. No `fastify-type-provider-zod`: its required peers pull in Swagger/OpenAPI, and the validator hook is a few lines.

### S2.2 `packages/contracts` ✅
- zod schemas + TS types for: account-api HTTP API, social HTTP API, instance-server internal API, and **broker subjects** (`chat.global`, `chat.party.<partyId>`, `chat.whisper.<characterId>`, `party.updated.<partyId>`, `session.kick.<characterId>`).
- Typed HTTP client helpers generated from these schemas.
- Implemented modules: `accountApi`, `social`, `broker` (channels `chat.global`, `chat.party`, `party.updated`, `session.kick`), `redisKeys`, `placement` (parsing `SERVERS` / `ZONE_PLACEMENT`), and `createHttpClient` (validates responses with the route's schema). Runs in the browser too, so it is held to the same no-I/O rule as `game-core`.
- Instance servers keep a local party cache (seeded from `social` when a character arrives, updated by `party.updated`); tickets carry the `partyId`, so placement never waits on a network call.

### S2.3 `packages/auth` ✅
- **Session token:** JWT (`jose`), `{ sub: accountId, exp: 24h }`, issued by account-api.
- **Transfer ticket:** JWT, `{ jti, characterId, accountId, zoneId, partyId?, viaPortalId?, targetServerId, exp: 30s }`.
- Signing: shared HMAC secret in Stage 2 (all trusted services hold it). Stage 3 switches tickets to Ed25519 so instance servers only hold the public key.
- Replay protection: `jti` claimed once via Redis `SET ticket:<jti> 1 NX EX 60`. The auth package only signs and verifies (signature, expiry, target server); claiming the `jti` happens in the instance server's handoff code (S2.8).
- Refresh secrets are random, stored only as SHA-256 hashes, and compared in constant time.

### S2.4 `packages/messaging` ✅
- `Broker` interface: `publish(channel, msg)`, `subscribe(channel, handler)`; typed by `contracts`. Incoming messages are validated against the channel schema and dropped (with a log) if invalid. Pattern subscriptions were not needed for the Stage 2 channels.
- Implementations: `InMemoryBroker` (tests), `RedisBroker` (ioredis pub/sub). Both pass one shared test suite; the Redis tests run against a throwaway Redis via Testcontainers (or `TEST_REDIS_URL`).
- Redis is chosen over NATS for now because we need Redis anyway (leases, presence). The interface keeps NATS possible later.

### S2.5 `apps/account-api` ✅
- Framework: Fastify.
- Owns tables: `Account`, `Character` (create/delete/list; gameplay-state columns are written by the lease holder, see S2.7).
- Endpoints:
  - `POST /auth/guest { nickname }` → creates account, returns `{ sessionToken, refreshSecret }` (the client stores the refresh secret like today's localStorage token).
  - `POST /auth/refresh { refreshSecret }` → new session token.
  - `GET /characters`, `POST /characters { classId }`, `DELETE /characters/:id`.
  - `POST /play { characterId }` → `{ url, ticket }` for the character's nexus server (static placement).
- Multiple characters per account (character select screen in the client).
- Moves `accountService`, repositories, and mappers out of the instance server; the instance server keeps only a slim character-state repository. *(The instance server's copy is removed together with its in-game login in S2.11; until then both exist.)*
- Refresh secrets are stored as SHA-256 hashes (`Account.refreshSecretHash`, hand-written migration that hashes existing tokens in place).
- Zero-config development: dev-only signing secrets (`@mmoexile/auth`) and a single-server placement (`DEV_SERVER_URLS`, `DEV_ZONE_PLACEMENT` in contracts); `NODE_ENV=production` refuses the dev secrets.

### S2.6 Protocol Changes (`packages/protocol`) ✅
- Remove `c2s_join` (login is HTTP now).
- `c2s_hello { ticket, clientVersion }`: the first packet on every connection.
- `s2c_welcome` loses `token`.
- `s2c_reconnect { url, ticket, zoneId }`: "go connect over there".
- `s2c_kicked { reason: "logged_in_elsewhere" | "server_shutdown" | "invalid_ticket" | "version_mismatch" }`.
- `PROTOCOL_VERSION` constant checked in `c2s_hello`.

### S2.7 Ownership Lease + Fencing ✅
- **Lease** in Redis: `lease:char:<id> = { serverId, instanceId, epoch }`, `SET NX PX 30000`, renewed every 10 s by the holding server.
- **Fencing epoch** in Postgres: new column `Character.ownerEpoch`. Acquiring a lease increments it (`UPDATE … SET ownerEpoch = ownerEpoch + 1 RETURNING ownerEpoch`).
- **Every state write is conditional:** `UPDATE Character SET … WHERE id = $1 AND ownerEpoch = $2`. A server that lost its lease (GC pause, network split) can no longer overwrite newer data. Its write affects 0 rows, which it treats as "I've been fenced": it drops the character and disconnects the client.
- Lease renewal failure → same as fenced.
- Implemented in `apps/instance-server/src/ownership/`: `CharacterOwnership` (`acquire`, `forceAcquire`, `renew`, `release`, `writeFenced`) and `LeaseKeeper` (renews every TTL/3, reports lost leases). Renew and release run as Lua scripts that only act if the lease still holds our exact value. If bumping the epoch fails, the lease reservation is rolled back. Wired into the connection flow with the protocol switch (S2.6/S2.8/S2.11).

This lease-plus-fencing pattern is the core anti-duplication mechanism. It deserves careful tests (S2 Tests).

### S2.8 Handoff Protocol ✅

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

### S2.9 Duplicate Login Policy: "Newest Login Wins" ✅
- A new ticket for a character whose lease is held → the claiming server publishes `session.kick.<characterId>`. The holder saves, releases, and sends `s2c_kicked(logged_in_elsewhere)`. The claimer retries the lease for up to 5 s; if that fails, it force-takes by bumping the epoch (the old holder is then fenced).

### S2.10 `apps/social` ✅
- Owns parties (moved from the Stage 1 in-process `PartyService`), stored in Redis (parties are ephemeral).
- HTTP API for party operations (called by instance servers when players type `/invite` etc.).
- Publishes `party.updated.<partyId>`; instance servers forward it to affected clients as `s2c_party_update`.
- **Chat routing stays on the broker:** instance servers publish player messages to `chat.global` / `chat.party.<id>` and subscribe to the subjects relevant to their connected players. Instance-local chat never leaves the instance server. `social` adds rate limiting and mute lists on top.
- **Presence:** `presence:<characterId> = { serverId, instanceId, zoneId }` in Redis (written by the lease holder), used for whispers and "join party member".

The client keeps **one** connection (to its current instance server). Social features flow through it; the client never talks to `social` directly.

*Implementation notes:*
- *`social` keeps parties in Redis and serializes all changes through an in-process queue. That is safe for the single social process of Stage 2; running several would need Redis transactions.*
- *Instance servers use a `PartyDirectory` (HTTP to social; an in-memory implementation with the same rules for tests), a `PartyCache` fed by `party.updated` for synchronous placement lookups, and a Redis `Presence` registry (`/invite <name>` across servers, refreshed every 20 s).*
- *Rate limiting and mute lists are not implemented yet.*
- *Disconnecting leaves the party; handoffs and kicks don't (the character is still online).*

### S2.11 `apps/instance-server` Changes ✅
- Accepts connections only with valid tickets; no more login logic.
- Periodic saves use the fenced write; the shutdown flush (existing logic) becomes "save + release all leases + `s2c_kicked(server_shutdown)`".
- Internal HTTP: the existing `/health` and `/debug/instances` (Stage 1) cover debugging; a separate `/internal/status` was not needed.
- Implementation: `PlayerLifecycle` (admit, hand off, leave, kick, drop when fenced, shutdown), `FencedCharacterWriter` behind the batched `PersistenceService`, and a composition root `createInstanceServer()` that integration tests start twice in one process. The old in-game login (`c2s_join`, `accountService`, repositories) is gone; account-api owns accounts and characters.

### S2.12 Client Changes ✅

*Implemented: sign-in screen (skipped when the stored refresh secret still works), character select with create (wizard/knight), delete (two-click confirm) and a graveyard, `c2s_hello` with the ticket from `/play`, `s2c_reconnect` behind a loading overlay, and kick reasons shown on character select. Verified in headless Chrome.*
- Login / character-select screens talk to `account-api` over HTTP.
- `NetworkManager` supports `reconnect(url, ticket)`: tear down the socket, show a loading screen, connect, send `c2s_hello`, wait for `s2c_welcome`, and replace world state.
- Handles `s2c_kicked` with a clear message.

### S2.13 Docker ✅
- `infra/docker/node.Dockerfile`: shared multi-stage template (pnpm fetch → `pnpm deploy --filter <app> --prod` → `node:22-slim` runtime, non-root user).
- One thin `Dockerfile` per app, or build args on the shared template.
- `infra/compose/docker-compose.yml`: the full topology above, with healthchecks and `depends_on: condition: service_healthy`.
- `pnpm realm:up` / `pnpm realm:down` convenience scripts.
- *Implementation notes:*
  - *One compose file: `pnpm db:up` starts only Postgres and Redis (for `pnpm dev`); the services sit under a `realm` profile used by `pnpm realm:up`. A one-shot `migrate` service applies Prisma migrations before the services start.*
  - *`infra/docker/node.Dockerfile` serves all Node services via `--build-arg APP=…`: `pnpm fetch` (cached on the lockfile), install, `pnpm deploy --legacy --prod`, then a slim `node:24-slim` runtime running as `node`. `--legacy` keeps local development on symlinked workspace packages.*
  - *Services run TypeScript through `tsx`, as in development, because the workspace packages are source-first. Compiling everything to JavaScript (build outputs plus export maps per package) is a later improvement.*
  - *The Prisma client is generated into `packages/db/generated/` (listed in the package's `files`) with an explicit `debian-openssl-3.0.x` engine, so it ships with the deployed package; the copied package's `postinstall` is denied in `pnpm-workspace.yaml`.*
  - *The client image is a Vite build served by nginx, which proxies `/api` to `account-api`.*
- `tools/bots`: a `Bot` that speaks the real protocol (account-api login, tickets, reconnects, breadth-first pathing to portals) and a `hop` soak script.

### Tests
- Unit: ticket sign/verify/expiry/replay; lease acquire/renew/expire; fenced write rejects a stale epoch.
- Integration (in-process, no Docker): two `InstanceServer` instances + `InMemoryBroker` + in-memory lease store + test Postgres. Portal on A → character appears on B with identical state; A can no longer write.
- Chaos-style integration: kill A mid-handoff (before and after step 2) → no duplication, bounded progress loss.
- `tools/bots`: headless bot client (uses `protocol` + the account-api HTTP client) that logs in, walks, and uses portals. Used for e2e against docker-compose.

### Acceptance Criteria
- [x] `pnpm realm:up` brings up the full topology; the game is playable at `http://localhost:8080`. *Verified in headless Chrome: sign in, create characters, play, resume after reload.*
- [x] Entering the overworld portal visibly reconnects from server A to server B (loading screen, server ID in the debug overlay), with HP/MP/XP/inventory preserved. *Loading screen yes; there is no debug overlay with the server ID (the switch was verified via the server URL in bots). State preservation verified live for HP and by the two-server integration test (state saved on A arrives on B).*
- [x] Logging into the same character in a second tab kicks the first tab. *Verified across containers: first session on B kicked via the broker, second on A.*
- [x] `docker kill instance-server-b` while in the dungeon → the player gets disconnected; logging in again works after ≤30 s and loses ≤5 s of progress; no duplicated items. *Killed while the character was in the overworld (also on B). Re-login after 6.4 s via forced takeover (A waits 5 s for the dead holder). Progress loss is bounded by the 5 s periodic saves; not measured live.*
- [x] Global chat and party chat reach players on both servers. *Verified with a player on each server: invite by name, party update, `/p`, `/g`.*
- [x] A bot run of 50 bots hopping between zones for 10 minutes ends with zero lease or fencing errors in the logs. *14,675 cross-server hops, 0 failed hops, 0 kicks, 0 errors; no warnings or errors in any service log.*

---

## Stage 3: Orchestrator & Fleet

**Goal:** Replace static placement with a dynamic orchestrator. Instance servers become interchangeable; new instances are placed by load; dead servers are detected; servers can be drained.

### Target Topology (docker-compose)

| Service | Port | Role |
| :--- | :--- | :--- |
| `orchestrator` | 3003 (localhost only) | Fleet registry, allocation, the only ticket issuer |
| `instance-server-1..3` | 7001–7003 public, 9001 internal | Generic: any zone; `SERVER_ID` s1..s3 |
| `prometheus` | 9090 (localhost only) | Scrapes every service's `/metrics` |
| `grafana` | 3030 (localhost only) | Provisioned "Realm Overview" dashboard |

Plus `account-api`, `social`, `client`, Postgres and Redis from Stage 2.

### S3.1 `apps/orchestrator` ✅
- Owns the **instance registry**: `serverId → { url, region, capacity, load, state }` and `instanceId → { serverId, zoneId, partyId?, players, state }`.
- The registry lives in orchestrator memory, mirrored to Redis. It is **rebuildable**: after an orchestrator restart, instance servers re-register and re-report their instances on the next heartbeat. The orchestrator is a single process for now (a known single point of failure; leader election comes much later, if ever).
- *Implementation notes:*
  - *`Registry.ts` (in memory), `RegistryMirror.ts` (one key per server, `fleet:server:<id>`, 60 s TTL). On startup the mirror pre-fills the registry; heartbeats correct it.*
  - *Instances the orchestrator just created survive a heartbeat that doesn't list them yet (5 s grace), so a party can't get two instances because of a race between creation and reporting.*
  - *Allocations count as "reservations" on the instance until a heartbeat covers them, so a burst of logins does not overfill one shard.*
  - *The HTTP contract (`orchestratorApi`, `instanceServerApi`) lives in `packages/contracts`. The placement key helpers (`soloPartyId`, `portalKey`) moved to `game-core`, so orchestrator and instance servers share them.*

### S3.2 Server Registration & Heartbeats ✅
- On startup the instance server calls `POST /servers/register { serverId, url, region, capacity }` and then enters `ready`.
- Every 2 s: `POST /servers/:id/heartbeat { instances: [{ id, zoneId, partyId, players, state }], tickP95Ms, cpu }`.
- Missed 3 heartbeats (6 s) → server marked `dead`: excluded from placement, its instances dropped from the registry. The instance-server lifecycle states `starting → ready → draining → stopped` map 1:1 onto Agones later.
- *Implementation notes:*
  - *`FleetAgent` (instance server) registers, then reports every 2 s plus immediately (debounced 50 ms) when an instance is created or closed. Heartbeats carry the full identity, so a heartbeat from an unknown server registers it: this is what rebuilds the registry after a restart. A dead server that reports again is revived.*
  - *Each heartbeat also reports `eventLoopUtilization` (see S3.8 findings); the response carries the state the orchestrator wants (`draining`).*
  - *Instance servers got a second, internal HTTP port (`INTERNAL_PORT`, Fastify via service-kit) for the orchestrator and metrics. Clients only reach the public WebSocket port.*
  - *If the orchestrator is down, players keep playing; zone changes fail with a chat notice until it is back.*

### S3.3 Allocation API ✅
- `POST /allocate { zoneId, characterId, partyId?, viaPortalId?, preferInstanceId? }` → `{ url, ticket, instanceId }`.
- Runs the Stage 1 `InstanceManager` rules **globally** (across servers): reuse an existing instance where the policy allows, otherwise choose a server and call its internal `POST /internal/instances { instanceId, zoneId, partyId? }`.
- **Placement score:** exclude `draining`/`dead`/over-capacity servers; prefer the lowest `players + instances × weight`, penalize high `tickP95Ms`. Simple, observable, replaceable.
- Tickets now carry `instanceId` (the target server no longer resolves instances itself).
- *Implementation notes:*
  - *The request also carries `accountId` (for the ticket) and `excludeServerId` (draining); `via` is the full portal reference. The response adds `serverId` and `ticketId`.*
  - *`placement.ts` is pure: `serverScore = players + 5 × instances + 10 × (tickP95 − 20 ms)⁺ + 5 × (ELU − 60 %)⁺ in percent`. `chooseServer` ignores servers that are not `ready`, are full or excluded; ties go to the lower server ID.*
  - *Decisions for the same zone and owner (party, portal, or "public") are serialized with a per-key lock; the reservation happens inside it.*
  - *A server whose internal API fails is skipped and the next best one is tried (up to 3).*
  - *If the ticket's instance no longer exists when the player arrives, the target server's local `InstanceManager` creates an equivalent one, so the Stage 1 rules remain as a fallback.*

### S3.4 Ticket Issuance Moves to the Orchestrator ✅
- Ed25519 signing key lives only in the orchestrator (and account-api for the first login, or account-api calls `/allocate`: preferred, single issuer).
- Instance servers get only the public key. A compromised instance server cannot mint tickets.
- *Implementation notes:*
  - *Single issuer: account-api's `/play` calls `/allocate` (503 "All servers are full" if the fleet is full).*
  - *Keys are passed as the one-line base64 body of the PEM (`TICKET_PRIVATE_KEY`, `TICKET_PUBLIC_KEY`); full PEM also works. Development has a built-in key pair, refused when `NODE_ENV=production`; `pnpm --filter @mmoexile/auth keygen` makes a real one. Compose ships its own local pair.*
  - *A handoff now allocates **before** freezing the character, so a failed allocation leaves the player where they are.*

### S3.5 Instance Servers Become Generic ✅
- Remove `ZONE_PLACEMENT`; any server can host any zone.
- Portal use → `POST /allocate` → handoff (Stage 2 protocol, unchanged).
- Report instance lifecycle changes (created/closed/player count) in heartbeats plus immediate events for creation/closure.
- *Implementation notes:*
  - *`SERVERS`, `ZONE_PLACEMENT`, `hostsZone` and `packages/contracts/src/placement.ts` are gone. Each server keeps one warm nexus (zone `minWarmInstances`); the orchestrator fills the fullest shard first, so the extra warm hubs stay idle until needed.*
  - *"Immediate events" are immediate heartbeats rather than a separate endpoint.*

### S3.6 Draining ✅
- `SIGTERM` or `POST /servers/:id/drain` → the server enters `draining`: no new allocations.
- Public hub instances: players are handed off to other shards of the same zone (handoff protocol, `preferInstanceId` unset).
- Private instances: continue until empty or until `drainTimeoutSec` (e.g. 10 min), then remaining players are handed off to a nexus shard.
- When empty → `stopped` → process exits. This is exactly the behavior Agones expects from a game server.
- *Implementation notes:*
  - *`fleet/Drainer.ts`; `DRAIN_TIMEOUT_SEC` defaults to 600 (60 in compose). If players cannot be moved (no other server), the drain gives up 10 s after the timeout and the shutdown saves and disconnects them.*
  - *`service-kit`'s `handleShutdownSignals` got a drain phase: SIGTERM drains first, SIGINT (Ctrl-C) or a second signal shuts down at once. An orchestrator drain request goes through the same path.*
  - *Compose: `stop_grace_period: 2m` and `restart: on-failure` for instance servers, so a drained server (exit 0) stays stopped.*
  - *Players are told once in chat when a drain starts.*

### S3.7 Observability ✅
- `service-kit` exposes Prometheus metrics: players, instances, tick duration histogram, handoff duration, lease conflicts, fenced writes, allocation latency, ticket rejections.
- docker-compose adds Prometheus + Grafana with one provisioned "Realm Overview" dashboard.
- Correlation: the ticket `jti` appears in the logs of every service involved in a handoff.
- *Implementation notes:*
  - *`createMetrics(service)` (prom-client registry with process metrics) and `GET /metrics` via `createHttpService({ metrics })`. Instance servers serve it on the internal port.*
  - *Handoff duration is measured on the target: ticket issue time → admission, so it includes the client's reconnect.*
  - *The orchestrator also exports per-server gauges from heartbeats (players, instances, tick p95, ELU, servers by state), so the dashboard works even when a server can't be scraped.*
  - *The dashboard JSON is in `infra/observability/grafana/dashboards/`; Grafana allows anonymous viewers and opens it as the home dashboard.*

### S3.8 Scaling Locally ✅
- docker-compose defines `instance-server-1..3` explicitly (each needs its own published port for direct client connections).
- Documented experiment: start with 1, add 2 more, watch placement spread new instances; drain one, watch players move.
- *Implementation notes:*
  - *The experiment is in the README ("Experiment: Scale, Kill and Drain Servers").*
  - *`tools/bots` `hop` got `--route` (e.g. `nexus,overworld,golem_dungeon`: every bot opens its own dungeon), per-server placement counts, death detection (deaths are announced in chat only) and a report of its own event loop lag.*
  - *`tools/realm-tests`: orchestrator, instance servers and account-api in one process for the multi-service tests below.*
- *Findings from the 300-bot load test, fixed in this stage:*
  - *__Empty instances were ticking.__ About 100 private dungeons per server, kept for re-entry, each ticking at 30 Hz with nobody inside. Empty instances now sleep (the runner stops when the last player leaves and starts when one enters).*
  - *__Tick duration hides saturation.__ All instances of a server share one event loop. Ticks stayed at ~1.5 ms p95 while the loop was 93–99 % busy and instances only got 11–23 of their 30 ticks per second. Heartbeats now report event loop utilization (ELU), placement penalizes ELU above 60 %, and instance servers export `mmoexile_tick_interval_seconds` (time between two ticks of the same instance; 33 ms when keeping up). The dashboard shows ELU and the tick interval p99 per server.*
  - *__Snapshot encoding was 70 % of the CPU.__ A CPU profile of a loaded server showed MessagePack-encoding each player's snapshot dominating (half of it strings), the simulation only ~5 %. `SnapshotEncoder` (protocol) now encodes each entity once per tick and assembles every player's packet from the cached bytes. The output is byte-for-byte identical, so clients are unaffected.*

### Tests
- Unit: placement scoring; registry rebuild from heartbeats; dead-server detection with fake clock.
- Integration: 3 in-process instance servers + orchestrator; allocate 60 dungeon instances → spread across servers within ±20%.
- Integration: drain a server with 10 hub players → all end up on other servers with state intact.
- Load: `tools/bots` with 300 bots over 3 servers for 15 minutes; tick p95 stays below 33 ms on every server.
- *Implemented as:*
  - *`apps/orchestrator`: registry (heartbeat rebuild, dead detection and revival with a fake clock, creation grace, reservations, sticky drain), Redis mirror restore, placement scoring (incl. ELU), instance selection per access policy, allocator (one instance for a party arriving at once, even spread of 30 over 3, failing servers skipped, 503/400).*
  - *`apps/instance-server`: `FleetAgent` against a fake orchestrator (register, reports, immediate report on creation, drain request, orchestrator down), the internal API, sleeping instances, and the Stage 2 two-server handoff test with a fake allocator.*
  - *`tools/realm-tests` (orchestrator + 2–3 instance servers + account-api in one process, real Postgres/Redis): registration; dead within 10 s; graceful stop reported; registry rebuilt within one heartbeat after an orchestrator restart (mirror deleted); a ticket admits into exactly the allocated instance; fill-first across servers; **60 dungeons spread within ±20 % (16–24 per server)**; **10 hub players drained to other servers with HP intact, then the server stops**; a dungeon player stays until the drain timeout, then moves to a nexus elsewhere; a full journey (login → `/play` → portal handoff) with metrics checked.*
  - *`packages/protocol`: `SnapshotEncoder` is byte-identical to `serializePacket` (including array header boundaries 16 and 65,536).*

### Acceptance Criteria
Verified against the Docker realm (`pnpm realm:up`, three instance servers) with `tools/bots` running, plus `tools/realm-tests`.

- [x] No static zone placement remains; any server hosts any zone. *`SERVERS`/`ZONE_PLACEMENT` are removed from code, config and compose. In the load run every server hosted nexus, overworld and dungeon instances.*
- [x] Killing a server: the orchestrator marks it dead within 10 s; no new instances land there; affected players can log back in. *`docker kill` of s2 under load with 60 bots: marked dead after 6.1 s (6.8 s in an earlier run). No instance was created on s2 after the kill. Allocations into s2's existing hub shards stopped about 1.8 s after the kill, once its heartbeat was overdue: servers silent for 1.5 intervals get no players even before they are declared dead (a fix made during this verification). Players already sent there in that window, and those connected to s2, saw the connection drop and logged in again on s1/s3; re-logins take ~5–10 s, because the new server waits 5 s for the dead holder before forcing the takeover.*
- [x] Draining a server moves its hub players away without data loss and the process then exits cleanly. *Orchestrator drain of s3 with ~70 hub players: empty and exited with code 0 after 1.2–1.9 s. `docker compose stop` (SIGTERM through the `tsx` wrapper) with 40 players: same, 0 kicks, 0 failed hops. State preservation is asserted in `realm-tests` (10 hub players keep their HP; a dungeon player stays until the drain timeout, then moves with HP intact).*
- [x] Restarting the orchestrator does not disconnect any player; the registry is rebuilt within one heartbeat interval. *Orchestrator stopped, its Redis mirror deleted, started again under load: all three servers were back in the registry 63 ms and 1.9 s (two runs) after it answered, i.e. from heartbeats alone within one 2 s interval. 0 kicks/disconnects; zone changes attempted while it was down failed with a chat notice and were retried. A fresh orchestrator now waits up to two intervals for heartbeats instead of answering "fleet full".*
- [x] The Grafana dashboard shows per-server players, instances, and tick times during a bot run. *See `docs/images/realm-overview.png`: players, instances, tick duration, event loop utilization and tick interval per server, plus handoff and allocation latency.*

**Load test** (300 bots in 3 processes over 3 servers, 15 minutes, route nexus → overworld → golem dungeon, so every bot also opens private instances): 40,127 cross-server handoffs, 0 failed hops, 0 kicks, 0 errors, 2,680 bot deaths (normal gameplay). Tick p95 ≤ 2.4 ms on every server in every 1-minute window (p99.9 ≤ 5 ms; the budget is 33 ms). Up to 154 players and 561 instances (mostly sleeping) per server, under 500 MB each, event loop utilization ≤ 59 % (average 33–49 %). No warnings or errors in any service log. The tick interval metric was added after this run; a second 300-bot run showed the servers keeping pace: time between two ticks of an instance p50 32 ms, p99 36–38 ms (nominal 33 ms). Zone-change handoffs (ticket issued → admitted on the target, incl. reconnect): p50 19–25 ms, p95 47–132 ms.

Not done / caveats:
- *A crashed server's players lose up to 5 s of progress (periodic saves); not measured live in Stage 3.*
- *Players still sent to a server in the first ~2–3 s after it died get a failed connection and must log in again. Closing that window needs faster failure detection (e.g. instance servers watching each other, or Agones health checks in Stage 5).*
- *The orchestrator and the internal ports are protected only by not being published (compose publishes the orchestrator on 127.0.0.1 for the experiment). Service-to-service authentication is not implemented.*

---

## Stage 4: Regions

**Goal:** One realm, several regions (e.g. `eu`, `us`). Players play on game servers near them for low ping, while account-api, the orchestrator, social, Postgres and Redis stay central in one location. This is Path of Exile's **gateway** model: one account and one realm, and you pick the gateway you play on.

Decisions taken on 2026-10-03 (D8–D11 below): the player chooses a region with the fastest one preselected; a party's private instances run in the party leader's region; a new `apps/directory` publishes the regions; distance is simulated with `tc netem`.

### Target Topology (docker-compose)

| Location | Services |
| :--- | :--- |
| Central (no extra latency) | `account-api`, `orchestrator`, `social`, `directory`, `postgres`, `redis`, `client`, Prometheus, Grafana |
| Region `eu` (no extra latency: "next to" the central services) | `gateway-eu` (ping endpoint), `instance-server-1`, `instance-server-2` |
| Region `us` (+40 ms on everything it sends, via `tc netem`) | `gateway-us` (ping endpoint), `instance-server-3` |

What a region means:
- **Every instance belongs to one region**, because it runs on one server and every server is in one region. There is no special hub concept: hubs are instances of `public_sharded` zones, and the existing rules apply (fill the fullest shard below the soft cap, otherwise open a new one), now **within the player's region**. A region can have any number of nexus or overworld shards.
- **Home region:** the region the player chose at login. It is not stored anywhere: it lives in the ticket for the duration of the session and the selector picks the fastest region again next time. It is kept separately from the region they are currently in, because those differ when a player visits a party dungeon abroad (see below). Public zones are always allocated in the home region.
- **Private instances follow the party leader** (D9). A party with members in different regions (friends from EU and US) runs its dungeon in the leader's home region. Members from elsewhere play there with higher ping, and when they leave they return to hubs in their own home region. Without the home region they would stay stuck in the leader's region.
- **Chat, parties and friends stay global.** They go through central services that don't care about regions.
- **Handoffs between regions cost round trips to the central services**: lease, fenced save, load. Stage 4 measures this cost and reduces it where cheap.

### S4.1 Region Model ✅
- `packages/contracts`: a region ID type (`[a-z0-9-]+`), validated wherever regions appear.
- The home region is **not stored** (no account column, no browser storage): the selector preselects the fastest region every time, and the ticket carries the choice for the session.
- Tickets carry the player's home region (`region` claim). The instance server keeps it per admitted player and passes it on with every allocation, so a player visiting a leader's dungeon abroad comes back to their own region's hubs.
- Presence entries gain `homeRegion`, so the leader rule can look up a leader's region by character ID.
- Instance servers already report `REGION` in heartbeats; their configuration now requires an explicit value in compose (default stays `local` for `pnpm dev`).
- *Implementation notes:*
  - *`RegionId` and `LOCAL_REGION` live in `packages/contracts/src/regions.ts`; the instance server's `REGION` setting and the heartbeat's `region` are validated with it.*
  - *`AllocateRequest.region` is required (no silent default), and the orchestrator copies it into the ticket's `region` claim. A ticket with a missing or malformed region is rejected as `invalid_ticket`.*
  - *`AdmittedPlayer.homeRegion` comes from the ticket and goes into every allocation the player triggers, so it survives any number of handoffs. Until S4.4, account-api logs everyone in with `local`.*
  - *`Presence.set` takes `{ characterId, name, homeRegion }`, and `homeRegionOf(characterId)` answers the leader lookup.*

### S4.2 `apps/directory` ✅
- A tiny, stateless, global service: `GET /realms` → `[{ id, name, accountApiUrl, regions: [{ id, name, pingUrl }] }]`. Configured by environment (`REALM_NAME`, `REGIONS="eu=Europe=http://localhost:7100/ping,us=North America=http://localhost:7200/ping"`), cacheable (`Cache-Control`). One realm for now; the shape allows more later.
- **Gateway ping endpoints:** each region gets a minimal `gateway-<region>` container (nginx answering `GET /ping` with 204 and CORS headers). It sits in the region's network position, so its round trip is the player's latency to that region. It stands for the region's edge/gateway, which later may also become a TLS or WebSocket entry point.
- Served to the browser through the client's nginx (`/directory`), like `/api`.
- *Implementation notes:*
  - *The response is `{ realms: [...] }` rather than a bare array, so fields can be added later. The contract (`directoryApi`, `RealmInfo`, `RegionInfo`) and the `REGIONS` parser (`parseRegions`) live in `packages/contracts`, so account-api can validate regions against the same setting.*
  - *The directory also answers `GET /ping` itself; its default `REGIONS` is a single `local` region pinging it, so `pnpm dev` works without gateway containers. `pnpm dev` starts the directory on port 3004; Vite proxies `/directory` to it.*
  - *Gateways are plain `nginx:1.29-alpine` containers with `infra/docker/gateway.nginx.conf` mounted (ports 7100 for `eu`, 7200 for `us`). The `REGIONS` value is shared in compose through a YAML anchor.*

### S4.3 Region-Aware Allocation (orchestrator) ✅
- `AllocateRequest` gains `region` (the player's home region) and `leaderRegion?`.
- Rule per access policy:
  - `public_sharded`: only instances and servers in `region`.
  - `party_private`: an existing instance of the party is joined wherever it runs. A new one is created in `leaderRegion ?? region`.
  - `portal_bound`: the region of the source instance (the portal is in that world).
- The instance server fills `leaderRegion` from the party cache (leader ID) and presence (`homeRegion`); if the leader is offline, the requester's region is used.
- No server with capacity in the target region → 503 with `{ reason: "region_unavailable" }`. There is no silent spill-over to another region: the client asks the player instead (S4.5). During a handoff the player stays where they are with a chat notice (as in Stage 3).
- The registry and the metrics group servers by region; the placement score is unchanged within a region.
- *Implementation notes:*
  - *`targetRegion()` and `joinsAcrossRegions()` in `placement.ts` hold the rule; the Allocator filters joinable instances (public zones: target region only) and creation candidates (always the target region). The score is unchanged.*
  - *A `portal_bound` instance whose source instance is unknown (its server is gone) falls back to the home region.*
  - *`PlacementError` carries a `reason`; the orchestrator returns `{ error, reason }`, and `HttpError.reason` exposes it to callers. `ErrorResponse` gained the optional `reason`.*
  - *The instance server looks up the leader's region only for `party_private` targets: locally if the leader is on the same server, otherwise through presence. A failed lookup means "use the player's own region".*
  - *Metrics: `mmoexile_fleet_servers{state,region}`, the per-server gauges gained `region`, `mmoexile_allocation_failures_total{status,reason,region}`. The "Allocated" log line includes `homeRegion` and `serverRegion`.*

### S4.4 Login with a Region (account-api) ✅
- `POST /play { characterId, region }` validates `region` against the directory's list (account-api reads the same `REGIONS` config) and asks the orchestrator to allocate there. The region goes into the ticket as the player's home region; nothing is persisted.
- *Implementation notes:*
  - *`region` is required on `/play`. An unknown region answers 400. When the orchestrator answers `region_unavailable`, account-api answers 503 with `{ error: "<Region name> is unavailable right now", reason: "region_unavailable" }`; other failures stay "Game servers are unavailable".*
  - *Both services read `REGIONS` through `regionsSetting()` from contracts. `mmoexile_play_requests_total` gained a `region` label (results: `ok`, `region_unavailable`, `unavailable`).*
  - *Until S4.5 the client and bots send `local`.*
  - *Multi-service test `tools/realm-tests/src/regions.test.ts` (servers `eu1@eu`, `eu2@eu`, `us1@us`): EU and US players get separate hubs; Ben (US) enters the party dungeon first and it is still created on an EU server because Anna (EU) leads; Anna joins the same instance; Ben returns to his original US nexus; a drained US region answers `region_unavailable` while EU logins keep working.*

### S4.5 Client Region Selector ✅
- The login/character screen fetches `/directory/realms`, pings every region's `pingUrl` five times (`fetch` with `cache: "no-store"`, HTTP keep-alive, median of the last four to skip connection setup), and shows each region with its ping.
- Preselects and highlights the fastest region; the player can change it at any time before pressing Play. The choice is not remembered.
- On `region_unavailable` it shows "<Region> is unavailable right now" and lets the player pick another region.
- Bots get `--region <id>` (default: the fastest, measured the same way).
- *Implementation notes:*
  - *The measuring logic is shared by the browser and the bots and lives in `packages/contracts/src/regionPing.ts`: `measurePing` (5 sequential `no-store` fetches, 2 s timeout each, median of the last 4), `measureRegions` (all regions in parallel) and `fastestRegion` (lowest reachable ping, optionally skipping regions). It is unit-tested there.*
  - *The selector (`RegionSelector.tsx`) sits at the top of the character select screen. Pings are measured each time the screen opens; the fastest region is preselected until the player clicks one. Play stays disabled until a region is selected. Nothing is stored.*
  - *On `region_unavailable` the region is marked "unavailable", the next fastest is preselected, and the notice says "<Region> is unavailable right now. Pick another region or try again in a moment."*
  - *Bots: `--region <id>`, otherwise the fastest via the directory next to `--api` (`…/api` → `…/directory`, override with `--directory`). `hop` and `chaos` both use it.*

### S4.6 Two Regions in Docker Compose ✅
- `gateway-eu`, `gateway-us`; `instance-server-1/2` with `REGION=eu`, `instance-server-3` with `REGION=us`.
- **Latency:** a sidecar container per US service shares its network namespace (`network_mode: service:<name>`, `cap_add: NET_ADMIN`) and runs `tc qdisc add dev eth0 root netem delay 40ms`. The app images stay unchanged. Everything the US containers send is delayed 40 ms: to players and to the central services alike.
- The delay is configurable (`US_LATENCY_MS`), so the effect can be compared at 0, 40 and 120 ms.
- *Implementation notes:*
  - *Inverted sidecar: a `region-us` container (alpine + `iproute2-tc`, `infra/docker/netem.Dockerfile`) **owns** the US network namespace and applies netem; `gateway-us` and `instance-server-3` join it with `network_mode: service:region-us`. Joining the app's namespace instead would lose the delay whenever the instance server is killed and restarted (the chaos test does exactly that). `region-us` publishes the US ports (7200, 7003) and is the US services' hostname (`INTERNAL_URL: http://region-us:9001`, Prometheus target `region-us:9001`).*
  - *Measured with the shared ping code: eu ≈ 2 ms, us ≈ 43 ms (a fresh TCP connection pays the delay twice, 80 ms, which is why the first sample is dropped).*
  - *Verified: EU bots only used s1/s2 and US bots only s3. The US dungeon route ran with 0 kicks and 0 failed hops after a bot fix: bots now skip characters they saw die, because the death save can lag behind the next character list, especially at +40 ms.*
  - *Verified in a headless Chrome against the Docker realm: Europe was preselected (2 ms vs 43 ms); picking North America connected to `ws://localhost:7003/ws`; after `docker compose kill instance-server-3`, Play in North America showed "North America is unavailable right now…" with Europe preselected again. After restarting s3, netem was still active.*

### S4.7 Observability per Region
- Instance-server metrics get a `region` label; handoff duration gets `from_region`/`to_region` labels (from the ticket).
- The dashboard gets a region variable and a "Regions" row: players per region, handoff duration within vs. across regions, allocation failures by reason.

### S4.8 Measure and Reduce the Cross-Region Cost
- Measure admission on a US server at 40 ms: every sequential round trip to Redis or Postgres costs 40 ms (claim ticket, take lease, bump epoch, load character, …).
- Reduce the cheap parts: pipeline or batch independent Redis commands; load the character in the same round trip as the epoch bump where possible. The target is at most **4 central round trips per admission**. The protocol stays unchanged.
- Periodic saves are already asynchronous and need no change.

### Tests
- Unit (orchestrator): region filter per access policy; party instance in the leader's region; an existing party instance is joined across regions; `region_unavailable`.
- Unit (directory): config parsing, response shape, cache header.
- Multi-service (`tools/realm-tests`): two regions in one process. EU and US players get hubs in their own region; an EU-led party with a US member shares one dungeon on an EU server, and the US member returns to a US hub; a region without servers → `region_unavailable`.
- Client: region selector logic (median, preselection) as unit tests; the full flow checked in a browser against the Docker realm.
- E2E against the Docker realm with latency: bots per region; `pnpm chaos` extended with a **region outage** (all US servers killed: US players get `region_unavailable`, EU unaffected).

### Acceptance Criteria
- [ ] The login screen lists both regions with their measured ping, and preselects the faster one.
- [ ] EU players only ever see EU hubs, US players only US hubs; chat and parties work across regions.
- [ ] A party led by an EU player with a US member runs its dungeon on an EU server; the US member pays the higher ping there and is back in a US hub afterwards.
- [ ] With 40 ms added to the US region, the selector shows the difference, and the cross-region handoff cost is measured and visible in Grafana (admission ≤ 4 central round trips).
- [ ] Killing every US server: US logins get "region unavailable" with the choice of another region; EU players are unaffected; `pnpm chaos` passes.

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
| directory | 3004 | `DIRECTORY_` |
| gateway-eu / gateway-us (compose) | 7100 / 7200 | |
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

## Decisions

D1 and D7 were settled during Stage 1; D2, D3, D4 and D6 were decided on 2026-10-02 before Stage 2; D8–D11 on 2026-10-03 before Stage 4. D5 stays open.

| # | Decision | Outcome | Why |
| :--- | :--- | :--- | :--- |
| D1 | Dungeon access model | ✅ **PoE-style `party_private`** for the golem dungeon; RotMG-style `portal_bound` implemented and available for future dungeons | Matches the PoE instancing model this project follows |
| D2 | HTTP framework | ✅ **Fastify** | Mature and fast, built-in schema validation with zod via a type provider, pino logging included |
| D3 | Broker | ✅ **Redis only** (pub/sub for messages, keys for leases, tickets, presence) | One piece of infrastructure; pub/sub's fire-and-forget delivery is fine for chat and events. NATS stays possible behind the `Broker` interface |
| D4 | Same-server transfers | ✅ **Always reconnect**, every zone change goes through the handoff | One code path; the handoff and lease logic is exercised on every portal, like PoE's loading screens |
| D5 | Build orchestration | Open: plain `pnpm -r`; adopt Turborepo when builds get slow | |
| D6 | Characters per account | ✅ **Multiple**, with character select and create screens in the client | Matches RotMG and PoE; leases and tickets are per character from the start |
| D7 | Postgres in tests | ✅ **Testcontainers** (or `TEST_DATABASE_URL`) | Self-contained `pnpm test`, works in CI |
| D8 | How a player gets a region | ✅ **Player chooses, fastest preselected**; the choice is not stored (it travels in the ticket) | Like PoE's gateway selector: lowest ping by default, but players can join friends elsewhere |
| D9 | Region of a party's private instance | ✅ **The party leader's region** | Predictable ("we play on EU"); the leader decides |
| D10 | Who publishes regions | ✅ **New `apps/directory`** (stateless, global) | Clean separation; the global layer above realms in the target architecture |
| D11 | Simulating distance locally | ✅ **`tc netem`** via sidecar containers | Network-level, affects player and central traffic alike, no app changes |
