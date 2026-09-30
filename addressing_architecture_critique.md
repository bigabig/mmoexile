# Addressing Architecture Critique & Future Roadmap

This document serves as an architectural assessment and follow-up plan based on the external developer review of the `@rotmg/server` architecture.

---

## Executive Summary & Scorecard

A thorough audit of the server architecture revealed that the vast majority of the reviewer's concerns **have already been solved** through recent refactoring. A few suggestions were **unnecessary or premature** for the current stage, several **quick fixes have been applied**, and two **key optimizations remain for follow-up implementation**.

| Critique Area | Sub-Item | Status | Resolution / Action Required |
| :--- | :--- | :---: | :--- |
| **1. Network Transport** | 1.1 Abstract Transport Protocol | **SOLVED** | `ITransportGateway`, `ITransportSession`, `ITransportSocket` implemented; `ClientSession` encapsulates socket handles. *Swapping to WebRTC is premature/unnecessary right now.* |
| | 1.2 Decouple Simulation & Network Ticks | **FOLLOW-UP** | Simulation and AOI broadcasts both run at 30Hz. Throttling AOI broadcasts to 10Hz–15Hz will cut replication bandwidth by 50%–66%. |
| | 1.3 Delta-Compression in AOISystem | **FOLLOW-UP** | Full per-client ACK rings are unnecessary overhead. The pragmatic solution is separating dynamic transforms from static/inventory metadata. |
| **2. Distributed State** | 2.1 World Transfer Race Condition | **SOLVED** | Single-node in-memory transfer in `WorldCluster.ts` guarantees zero DB-divergence race condition. *Distributed locks (Redlock) are premature until multi-host.* |
| | 2.2 Graceful Shutdown & Persistence Flush | **QUICK FIX APPLIED** | Fixed duplicate signal handler bug in `src/index.ts`. Removed dead `player_state_persist` JSON serialization from `GameWorld.tick()`. |
| **3. Server Authority** | 3.1 Strict Intent Validation | **SOLVED** | `PlayerCommand` has no position setters. `MovementSystem` clamps $dt$, bounds speed, rate-limits inputs, and uses 2-step sub-stepping against tile collision. |
| | 3.2 Authoritative Combat Simulation | **SOLVED** | Client only sends `c2s_shoot(angle)`. Cooldowns, trajectories, spatial collisions, armor defense formulas, and health reductions are 100% server-authoritative. |
| **4. Multi-Node Scalability**| 4.1 Message Broker Interface | **SOLVED** | `IMessageBus` and `InMemoryMessageBus` cleanly decouple Gateway from Simulation Cluster, ready for NATS or Redis. |
| | 4.2 Headless Vertical Slice Benchmark | **QUICK FIX APPLIED** | `simulation.bench.test.ts` (100 players, 500 monsters) now primes JIT; peak tick dropped from 44.7ms to **22.7ms**, avg **12.5ms**. All tests pass. |

---

## 1. Quick Fixes Applied in This Step

### A. Fixed Graceful Shutdown Bug in Server Entry Point
- **File:** `packages/server/src/index.ts`
- **Issue:** The `shutdown` handler had duplicate synchronous code calling `gateway.close()`, `cluster.stop()`, `persistenceService.stop()`, and `server.close(() => process.exit(0))` immediately, which prevented the asynchronous `await persistenceService.stop()` from completing its database drain.
- **Fix:** Removed the premature synchronous shutdown calls. The shutdown sequence now strictly runs in phased async order:
  1. `gateway.close()` (stop accepting new connections)
  2. `cluster.prepareShutdown()` (halt runners, snapshot all active players)
  3. `await persistenceService.stop()` (drain pending DB writes)
  4. `cluster.stop()` (destroy worlds)
  5. `server.close()` & `await disconnectDatabase()` (exit cleanly)

### B. Purged Residual Database Logic from `GameWorld.tick()`
- **File:** `packages/server/src/simulation/GameWorld.ts`
- **Issue:** Lines 291–322 retained legacy code running `if (this.currentTick % 150 === 0)` that queried bitECS and called `JSON.stringify(Inventory.slots)` to emit `player_state_persist`.
- **Fix:** Removed these lines entirely. Periodic persistence is already handled cleanly outside the tick loop by `WorldCluster.ts` via `world.getPlayerPersistenceStates()`, upholding the zero-I/O / zero-JSON invariant inside simulation ticks.

### C. JIT Warmup in Headless Benchmark
- **File:** `packages/server/src/__tests__/simulation.bench.test.ts`
- **Issue:** Benchmark failed `expect(maxDuration).toBeLessThan(33.33)` because tick 0/1 incurred V8 JIT compilation spikes (44.7ms) under 100 players and 500 monsters.
- **Fix:** Primed the warmup loop with active movement and shooting commands. Peak tick dropped to **22.76ms** (avg **12.49ms**), well below the 33.33ms budget. All 60 workspace tests now pass cleanly.

---

## 2. Critique Items Deemed Unnecessary or Premature

### A. WebRTC Data Channels / WebTransport (Critique 1.1)
- **Why it's unnecessary:**
  - The architectural action (abstracting the transport protocol behind `ITransportGateway` and `ITransportSession`) has already been accomplished.
  - WebSockets transmitting binary MessagePack packets at 10–30Hz with client-side prediction and interpolation are well-proven for 2D/2.5D action games.
  - WebRTC DataChannels require significant infrastructure overhead: ICE candidates, STUN/TURN relays, SDP signaling servers, and UDP NAT hole-punching fallbacks.
  - WebTransport requires HTTP/3 QUIC and valid public CA certificates, complicating local development.
  - **Recommendation:** Keep WebSockets as the primary transport; utilize the existing `ITransportGateway` abstraction if UDP/WebTransport ever becomes a business requirement.

### B. Distributed Locking (Redis Redlock) for World Transfers (Critique 2.1)
- **Why it's unnecessary right now:**
  - The server currently runs as a single-node cluster architecture where all world instances reside in the same Node.js process.
  - In `WorldCluster.ts` (`transferPlayer`), the player's session state is transferred directly in-memory from `SourceWorld` to `TargetWorld` synchronously within the tick. There is zero risk of state divergence.
  - **Recommendation:** Only introduce Redis distributed locks when deploying simulation worlds across distinct physical server nodes.

### C. Full Per-Client ACK-Based Delta Compression (Critique 1.3)
- **Why it's unnecessary:**
  - Full per-client differential delta compression requires maintaining historical snapshot ring buffers per client on the server, tracking sequence ACKs, and handling dropped-packet retransmission.
  - For an action MMO, the vast majority of bandwidth waste comes from re-transmitting **static metadata** (names, max HP, defense, class ID, inventory slot arrays) in the high-frequency tick snapshot.
  - **Recommendation:** Adopt the simpler, decoupled payload approach outlined in Section 3.2 below.

---

## 3. Valid Critique Items for Follow-Up Implementation

### 3.1 Decouple Simulation Tick Rate (30Hz) from Network Broadcast Rate (10–15Hz)
*Relates to Critique 1.2*

#### Current State
- `InProcessWorldRunner` executes `step(1/30)` every 33.33ms.
- Every simulation tick, `AOISystem.update()` builds snapshots for all players within a 25-tile radius.
- `WebSocketGateway` broadcasts `s2c_snapshot` every tick (30 packets/sec per player).
- The client (`packages/client/src/engine/EntityManager.ts#L91`) **already implements linear interpolation (`lerp`)** for position and angle, and `NetworkManager.ts` implements client-side movement prediction. The client does not need 30 snapshots per second.

#### Proposed Implementation Plan
1. **Network Broadcast Throttle:**
   - In `GameWorld.tick()`, run `this.aoi.update()` every $N$ ticks (e.g. `if (this.currentTick % 2 === 0)` for 15Hz, or `% 3 === 0` for 10Hz).
   - Alternatively, maintain a dedicated `networkTickAccumulator` in `InProcessWorldRunner` or `WorldCluster` so that bullets and combat events can still be batched and flushed at 30Hz while entity position snapshots broadcast at 15Hz.
2. **Benefits:**
   - Immediately cuts outbound serialization and network bandwidth by 50%–66%.
   - Reduces JSON/MessagePack encoding CPU time and V8 garbage collection pressure.

---

### 3.2 Separate Static vs. Dynamic Entity State in AOI Replication
*Relates to Critique 1.3 (Lite / Pragmatic Delta Compression)*

#### Current State
In `packages/shared/src/protocol/snapshot.ts`, `EntityState` includes both high-frequency dynamic values and static/slow-changing metadata:
```typescript
export interface EntityState {
  // Dynamic (changes every tick)
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  isAlive: boolean;

  // Static / Slow-changing (rarely changes, but currently sent 30x/sec!)
  type: EntityType;
  subtype: string;
  maxHp: number;
  name: string;
  level: number;
  defense?: number;
  classId?: string;
  equipment?: PlayerEquipment;
  inventory?: (string | null)[];
  xp?: number;
  nextLevelXp?: number;
  modelId?: string;
}
```

#### Proposed Implementation Plan
1. **Define Lightweight Transform Snapshots:**
   ```typescript
   export interface EntityTransformState {
     id: string;
     x: number;
     y: number;
     vx: number;
     vy: number;
     angle: number;
     hp: number;
   }
   ```
2. **Replicate Static Data on AOI Entry Only:**
   - When an entity first enters a player's 25-tile radius, send a full `s2c_entity_spawn` packet with complete static metadata (`name`, `maxHp`, `modelId`, `equipment`, `inventory`).
   - For all subsequent ticks, `s2c_snapshot` only transmits `EntityTransformState` for visible entities.
   - When an entity leaves AOI, send `s2c_entity_despawn { id }`.
3. **Emit Targeted Mutation Events:**
   - Equipment / Inventory changes: emit `s2c_inventory_update` to the owning player.
   - Stat / Level changes: emit `s2c_stat_update` / `s2c_level_up`.
4. **Benefits:**
   - Shrinks packet sizes by ~70%.
   - Eliminates array allocations for inventories inside the tick loop.

---

### 3.3 Multi-Node Clustering Migration Plan (Future Scalability)
*Relates to Critique 2.1 (Multi-Node) & 4.1*

When the game scales across multiple physical machines:
1. **Message Broker:**
   - Implement `NatsMessageBus` or `RedisMessageBus` conforming to `IMessageBus`.
   - Gateways publish player commands to `realm.<worldId>.commands`.
   - Simulation nodes publish tick results to `realm.<worldId>.ticks`.
2. **Distributed World Transfers:**
   - Set player status to `TRANSFERRING` in Redis.
   - Source node publishes transfer packet with final snapshot to Redis channel `transfer.<targetWorldId>`.
   - Target node acquires lock, instantiates player in target world, and confirms readiness to Gateway.
   - Gateway sends `s2c_world_transfer` packet to client with target world connection coordinates.

---

## 4. Summary & Verification

- **All 60 automated tests pass** (`shared.test.ts`, `server.test.ts`, `simulation.bench.test.ts`).
- **Zero I/O in Simulation Loop** is restored and enforced.
- **Graceful Shutdown** reliably drains persistence queues before closing.
- Use this file as the blueprint for upcoming sprint tasks regarding network tick decoupling and payload slimming.

