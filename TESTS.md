# Testing Guide

What kinds of tests this project uses, what each one is for, and how to run it.

---

## Definitions

| Kind | In one sentence |
| :--- | :--- |
| **Unit test** | Tests one small piece of logic (a function or class) on its own, without network or database. |
| **Integration test** | Tests that your code works together with real infrastructure, such as Postgres or Redis. |
| **Multi-service test** | Starts several services together (e.g. orchestrator + game servers) and tests them as one system. |
| **End-to-end (E2E) test** | Tests the real deployment from the outside, the way a player uses it. |
| **Smoke test** | A short, quick E2E check that the system basically works ("does it start, can you play?"). |
| **Load test** | Puts the expected amount of users on the system and checks that it stays fast. |
| **Stress test** | Pushes beyond the expected load to find where and how it breaks. |
| **Soak test** | Runs a moderate load for a long time to find problems that grow slowly (memory leaks, piling-up data). |
| **Chaos test** | Breaks parts of the system on purpose (kill a server, restart a service) and checks it recovers. |
| **Benchmark** | Measures how fast one specific piece of code is, so slowdowns are noticed. |
| **Regression test** | Any test written after a bug was found, so the same bug can't come back unnoticed. |
| **Acceptance test** | Checks a feature or stage against the requirements written beforehand ("is it done?"). |

Words that come up often:

- **Test double (fake, mock, stub):** a stand-in for a real dependency, e.g. a fake orchestrator that only records requests.
- **Fake clock:** the code asks a `now()` function for the time, and the test controls it, so "wait 6 seconds" takes no time.
- **Flaky test:** a test that sometimes passes and sometimes fails without code changes. Usually caused by timing or shared state; always worth fixing.
- **Bot:** a simulated player: a program that speaks the real game protocol, without graphics (`tools/bots`).

---

## The Test Pyramid

```
          ▲ realistic, slow, run by hand
          │   Chaos / soak / load tests     Docker realm + many bots
          │   Smoke tests                   Docker realm + a few bots
          │   Multi-service tests           tools/realm-tests
          │   Integration tests             real Postgres + Redis
          │   Unit tests                    pure logic
          ▼ fast, cheap, run on every change (pnpm test, CI)
```

Have many tests at the bottom and few at the top. The bottom tells you quickly *that* something is wrong and *where*; the top tells you whether the whole system works under real conditions. Both are needed: in Stage 3 every unit test passed, but only the load test showed that one server could handle just ~90 players.

---

## Unit Tests

**Purpose:** prove that a piece of logic is correct, including edge cases, in milliseconds.

**Where:** next to the code, in `src/__tests__/*.test.ts` of each app and package. They use [Vitest](https://vitest.dev).

**Run:**

```bash
# Everything (unit + integration + multi-service), all packages
pnpm test

# One package
pnpm --filter @mmoexile/orchestrator test

# One file (matched by name)
pnpm --filter @mmoexile/orchestrator exec vitest run registry

# Watch mode: re-runs on every save, great while coding
pnpm --filter @mmoexile/orchestrator exec vitest
```

**Write one:** pick one function or class, give it inputs, check outputs. Replace slow or external things with fakes.

```ts
it("marks servers dead after three missed heartbeats", () => {
  let clock = 0;
  const registry = new Registry({ now: () => clock, deadAfterMs: 6000 });
  registry.heartbeat(heartbeat("s1"));

  clock = 6001;                      // fake clock: no real waiting
  registry.sweep();
  expect(registry.get("s1")?.state).toBe("dead");
});
```

**Examples:** placement scoring and the allocator (`apps/orchestrator`), the fleet agent against a fake orchestrator (`apps/instance-server`), ticket signing (`packages/auth`), and `SnapshotEncoder` producing exactly the same bytes as before (`packages/protocol`).

---

## Integration Tests

**Purpose:** prove that the code works with the real infrastructure. A fake can't tell you whether a Redis Lua script or a Postgres `UPDATE … WHERE ownerEpoch = …` really does what you think.

**Where:** in the same test folders; they use the database or Redis. Examples: `apps/instance-server/src/__tests__/handoff.integration.test.ts` (two game servers hand a character to each other), `ownership.test.ts`, `apps/account-api`, `apps/social`, `agones.integration.test.ts` (an instance server with `LIFECYCLE=agones` against Agones' real SDK server, started in local mode as a container: Ready, Allocated while held, Shutdown; no cluster needed), and `outage.integration.test.ts` (an instance server whose Postgres and Redis are behind an "outage proxy" that can freeze every connection like `docker pause`: a zone change during a Postgres outage, zone changes refused while it is known to be down, the lease kept until the final save is written, a Redis outage shorter than the lease).

**Run:** part of `pnpm test`. Docker must be running: [Testcontainers](https://testcontainers.com) starts a throwaway Postgres and Redis for the test run and removes them afterwards (see `test/globalSetup.ts` in each app).

To use databases you already have instead (faster when running tests often):

```bash
TEST_DATABASE_URL=postgresql://mmoexile:mmoexile@localhost:5432/mmoexile_test \
TEST_REDIS_URL=redis://localhost:6379 \
pnpm --filter @mmoexile/instance-server test
```

---

## Multi-Service Tests

**Purpose:** prove that the services work *together*: registration, allocation, tickets, handoffs, draining. These are the plan's acceptance criteria, but automated.

**Where:** `tools/realm-tests`. `harness.ts` starts a whole realm in one process: orchestrator, 2–3 instance servers and account-api, with real HTTP, WebSockets, Postgres and Redis. Tests connect raw protocol clients (`TestClient`) to it.

| File | Proves |
| :--- | :--- |
| `fleet.test.ts` | Servers register; a silent server is marked dead; an orchestrator restart rebuilds the registry |
| `allocation.test.ts` | Tickets lead into the right instance; hubs fill up first; 60 dungeons spread evenly |
| `drain.test.ts` | Draining moves players away with their state intact |
| `journey.test.ts` | Login → play → portal → other server, and the metrics record it |
| `regions.test.ts` | Two regions (`startRealm({ servers: ["eu1@eu", "eu2@eu", "us1@us"] })`): hubs per region, chat and parties across regions, a party dungeon in the leader's region, `region_unavailable` |

**Run:**

```bash
pnpm --filter @mmoexile/realm-tests test

# See the services' logs while debugging
REALM_LOG_LEVEL=info pnpm --filter @mmoexile/realm-tests exec vitest run drain
```

**Limits:** everything shares one process. The servers share one event loop, so anything about real CPU load or real network failures belongs in the Docker tests below.

---

## Benchmark

**Purpose:** notice when the simulation gets slower. One tick for 100 players and 500 monsters must stay well below the 33 ms budget (30 ticks per second).

**Run:**

```bash
pnpm bench
```

It prints the average, p95 and max tick duration and fails if they exceed the limits. It runs on its own (not inside `pnpm test`), because other tests running in parallel would distort the timing. CI runs it as a separate step.

---

## Smoke Tests

**Purpose:** a quick check after building or deploying: does the realm start, can players log in and move between servers? Run it before spending time on longer tests.

**Run:**

```bash
# 1. Start the full realm in Docker (game: http://localhost:8080, Grafana: http://localhost:3030)
pnpm realm:up

# 2. A handful of bots for one minute
pnpm --filter @mmoexile/bots hop -- --bots 10 --minutes 1
```

**Pass:** the summary shows `hops` > 0 and `failedHops`, `kicks` and `errors` at 0. Also open http://localhost:8080 and play for a minute yourself.

The bots log in through account-api, pick a character and walk to portals. Options of the `hop` script:

| Option | Default | Meaning |
| :--- | :--- | :--- |
| `--bots` | 10 | Number of simulated players |
| `--minutes` | 1 | Duration |
| `--route` | `nexus,overworld` | Zones to travel through in a loop; add `golem_dungeon` to open private instances |
| `--api` | `http://localhost:8080/api` | account-api URL (use `http://localhost:3000` with `pnpm dev`) |

---

## Load Tests

**Purpose:** check that the system stays fast at the expected number of players, and find bottlenecks. The Stage 3 target: 300 players on 3 servers, tick p95 under 33 ms on every server.

**Run:** one bot process can comfortably drive about 100 bots, so start several:

```bash
pnpm realm:up
```

```bash
for i in 1 2 3; do
  pnpm --filter @mmoexile/bots hop -- --bots 100 --minutes 15 \
    --route nexus,overworld,golem_dungeon > load-$i.log &
done
wait
```

**Watch while it runs:** the Grafana dashboard "Realm Overview" at http://localhost:3030:

| Panel | Healthy |
| :--- | :--- |
| Tick duration p95 per server | well below 33 ms |
| Tick interval p99 per server | close to 33 ms (higher means ticks start late: the server is overloaded) |
| Event loop utilization | below ~60 % |
| Players / instances per server | roughly balanced for new instances |

**Afterwards:** check each `load-*.log` summary (`failedHops`, `kicks`, `errors` at 0) and the logs for warnings:

```bash
docker compose -f infra/compose/docker-compose.yml --profile realm logs --since 20m | grep -E '"level":(40|50)'
```

**Check the load generator too:** the summary's `botEventLoopLagMs` tells you whether the bot process itself was overloaded. If it was, the results measure the bots, not the servers.

**Finding the cause of a slowdown:** record a CPU profile of a running server to see which functions use the time (Node's inspector; in Stage 3 this showed that snapshot encoding used 70 % of the CPU). The Grafana panels tell you *that* something is slow; the profile tells you *what*.

**Stress test variant:** same commands, but keep adding bots (e.g. 100 more every few minutes) until the tick interval or error counts go bad. Then you know your limit and what breaks first.

---

## Soak Tests

**Purpose:** find problems that only appear over time: memory that keeps growing, data piling up (e.g. instances never being closed), connections leaking.

**Run:** a moderate load for a long time (30 minutes to several hours):

```bash
pnpm realm:up
pnpm --filter @mmoexile/bots hop -- --bots 50 --minutes 120 --route nexus,overworld,golem_dungeon
```

**Watch:** the trend over time, not single values.

```bash
# Memory per container, every few minutes
docker stats --no-stream --format "{{.Name}} {{.MemUsage}}"
```

In Grafana, set the time range to the whole run. "Instances per server" and memory should level off; a line that only goes up means something is never cleaned up.

---

## Chaos Tests

**Purpose:** prove that the system survives failures: a crashed server, a server being shut down, a restarted orchestrator. Always run them **under load** (bots playing), because that's when failures hurt.

### Automated: `pnpm chaos`

```bash
pnpm realm:up
pnpm chaos                    # 60 bots by default; more with: pnpm chaos -- --bots 100
```

`tools/bots/src/chaos.ts` starts its own bots, waits until they all play, then runs four experiments one after another, measuring each. The bots play in the fastest region (`--region` to choose):

| # | Experiment | What it does | Checks |
| :--- | :--- | :--- | :--- |
| 1 | Orchestrator restart | Stops the orchestrator, deletes its Redis mirror, starts it again | Fleet rebuilt from heartbeats within one interval (~2 s); nobody kicked or disconnected |
| 2 | Server crash | `docker compose kill` on the busiest instance server (started again afterwards) | Marked `dead` within 10 s; no new instance created on it; all bots playing again elsewhere |
| 3 | Drain | `POST /servers/<id>/drain` on the busiest server | Exits with code 0; reported `stopped`; its players moved without kick or disconnect |
| 4 | Region outage | `docker compose kill` on every server of another region (us) | All marked `dead` within 10 s; a login there gets `region_unavailable`; logins in the bots' region still work; its players are not kicked or disconnected |

At the end it starts the stopped servers again, prints a ✔/✘ line per check, and exits with code 1 if any check failed (so it could run in a pipeline later). A run takes about 2–3 minutes. Example output:

```
2. Server crash: docker kill instance-server-3 (s3, 44 players)
  ✔ marked dead within 10 s: 5.6 s
  ✔ its players logged in again elsewhere: all 60 bots online 6.0 s after the kill
  ✔ no new instance created on it: 0 created
...
PASSED: 13/13 checks
```

Expected side effects: bots on the killed server lose their connection (`disconnects` and `failedHops` in the bot summary) and log in again. Kicks must stay at 0.

### By hand

To explore on your own, start the realm and bots in one terminal and break things in another, with Grafana open:

```bash
pnpm --filter @mmoexile/bots hop -- --bots 60 --minutes 10
```

```bash
# The fleet as the orchestrator sees it (before and after each step)
curl -s localhost:3003/servers
```

| Experiment | Command | Expected |
| :--- | :--- | :--- |
| **Crash a server** | `docker kill mmoexile-instance-server-2-1` | Marked `dead` within 10 s; no new players go there; its players log in again elsewhere |
| **Graceful stop** (SIGTERM) | `docker compose -f infra/compose/docker-compose.yml --profile realm stop instance-server-1` | Drains: hub players move away, dungeons get `DRAIN_TIMEOUT_SEC`; exits with code 0; no kicks |
| **Drain via orchestrator** | `curl -X POST localhost:3003/servers/s3/drain` | Same as above, triggered remotely |
| **Restart the orchestrator** | `docker compose -f infra/compose/docker-compose.yml --profile realm restart orchestrator` | Nobody disconnects; all servers are back in `/servers` within ~2 s |
| **Bring servers back** | `docker compose -f infra/compose/docker-compose.yml --profile realm start instance-server-1 instance-server-2` | They register and receive new instances again |

Check an exit code after a stop:

```bash
docker inspect -f '{{.State.ExitCode}}' mmoexile-instance-server-1-1
```

**Pass:** the bot summary shows `kicks: 0`. After a crash, some `disconnects` and failed hops are expected (those players were on the dead server), but every bot should log in again and continue. Measure how long each recovery took; a recovery that works but takes a minute is still a finding.

---

## Cluster Smoke Test

**Purpose:** check the realm on Kubernetes with Agones, its databases next to the clusters and one cluster per region connected by the Linkerd mesh (Stages 5–7, [`infra/k8s/README.md`](infra/k8s/README.md)): what only exists there, i.e. autoscaling, rolling updates, Agones replacing a crashed server, TLS and least privilege, database outages, a region's cluster lost or cut off from central, and the mesh's mTLS and policies, with players online the whole time. `pnpm chaos` stays a compose tool; this is its counterpart for the cluster.

**Run:**

```bash
pnpm cluster:up                          # ~9 min the first time
pnpm cluster:smoke                       # ~8 min
pnpm cluster:smoke --mode failures       # ~4 min: only steps 10 and 11
pnpm cluster:smoke --mode persistence    # ~8 min: restarts the databases and the clusters
```

`tools/bots/src/clusterSmoke.ts` prints one line per check and exits with 1 if any failed:

1. **Reachable:** the directory lists eu and us, both gateways answer pings, us is farther away (simulated distance).
2. **Bots in each region:** 5 bots per region play (hubs and a dungeon), only on servers of their region, without kicks or errors.
3. **Scale up:** 70 more bots in eu; the eu Fleet gets another server; nobody is kicked.
4. **Scale down:** the 70 leave; the Fleet shrinks back; the remaining players stay connected.
5. **Rolling update:** `pnpm cluster:reload instance-server` replaces every instance server; players move without a kick; the autoscalers are back to their usual bounds.
6. **Crash:** `kill -9` inside the busiest eu server: the orchestrator marks it dead within 10 s, its players log in again, Agones replaces the GameServer.
7. **TLS and least privilege:** from a container on kind's network (where the pods' connections come from): connections without TLS are refused by Postgres, PgBouncer and Redis; a certificate check against another CA fails; the services' database user can read but not `DROP TABLE`.
8. **Postgres outage:** `docker pause` for 30 s: a login during it gets a clear 503; afterwards no save is waiting any more; no observer is kicked.
9. **Redis outage:** `docker pause` for 10 s: no observer is kicked.
10. **A region's cluster lost:** `docker kill` of the us node: the orchestrator marks the us servers dead within 10 s, a login into us gets `503 region_unavailable`, eu plays on undisturbed; after `docker start` us recovers on its own (servers register, logins work, its players log in again).
11. **A region cut off from central:** iptables on the us and central nodes drop each other's traffic (API servers, mesh gateways) for 30 s: logins into us get `503 region_unavailable`, players in us are not kicked and get "zone changes are paused" when they try; afterwards zone changes work again and still nobody was kicked; eu is undisturbed.
12. **The mesh:** every request the orchestrator accepted on its fleet and allocation routes came with mTLS (Linkerd's metrics); `POST /allocate` from the host (outside the mesh) and from social (meshed, not allowed) gets 403; the drain isn't reachable (404).

10 "observer" bots play in eu from step 3 to the end (10 more in us in steps 10 and 11); steps 3–5 and 8–11 check that none of them is kicked or disconnected. Step 3 also prints the load bots' failed hops: a burst bigger than the autoscaler's buffer (60 free slots) fills the region for the ~13 s until the new server is up.

**Persistence mode** (`--mode persistence`): creates a character, then `pnpm cluster-db:down` + `cluster-db:up` and `pnpm cluster:down` + `cluster:up`; after each, logs in with the account's refresh secret and finds the character again.

**Failures mode** (`--mode failures`): only steps 10 and 11, with the observers.

Options: `--load 70`, `--observers 10`, `--api http://localhost:8090/api`, `--orchestrator http://localhost:3013`, `--prometheus http://localhost:9091`, `--context-prefix kind-mmoexile-` (+ `central`, `eu`, `us`), `--mode realm|failures|persistence`.

The same runs on GitHub on demand (`.github/workflows/cluster-smoke.yml`, see CI below).

---

## Regression Tests

**Purpose:** make sure a fixed bug stays fixed.

**How:** whenever you find a bug (in a load test, a chaos test, or by playing), first write a test that fails because of it, then fix the code until it passes. Examples from Stage 3:

| Bug found | Regression test |
| :--- | :--- |
| Empty dungeons kept ticking | `lifecycle.test.ts`: "ticks an instance only while players are inside" |
| Players were still sent to a crashed server | `allocation.test.ts`: "stops sending players to a server that went quiet" |
| A restarted orchestrator answered "fleet full" | `registry.test.ts`: "waits for the first heartbeats" |
| Snapshot optimization must not change the wire format | `snapshotEncoder.test.ts`: byte-for-byte equality |
| (Stage 4) Bots re-used a character that had just died, because the death save lagged behind | `bot.ts` remembers fallen characters (a tool fix; the server was right to refuse) |
| (Stage 4) Admission needed 6 central round trips | `ownership.test.ts`: "claims a one-time key (a ticket) together with the lease", "writes only the given columns … in one fenced statement" |
| (Stage 5) The autoscaler could remove an empty server the orchestrator had just sent a player to | `agones.test.ts` / `agones.integration.test.ts`: "is Allocated before it answers the orchestrator's create-instance call", "is Allocated while the orchestrator says players are on their way"; `registry.test.ts`: "tells a server to hold once a player was placed on it" |
| (Stage 5) A rolling update never started the new version while every old server had players (Agones counts Allocated servers toward the Fleet's size) | `pnpm cluster:smoke` step 5: `cluster:reload` adds room for one server, drains the old ones one by one, restores the autoscaler |
| (Stage 5) Draining servers stopped pinging Health, so Agones killed them mid-drain | `agones.test.ts`: "keeps its state and health pings while draining, then shuts down" |
| (Stage 6) Handoffs can overshoot a server's capacity, and Agones refused the players Counter above it | `agones.test.ts`: "caps the players Counter at the capacity" |
| (Stage 6) A zone change during a Postgres outage left the player frozen, neither moved nor kicked | `outage.integration.test.ts`: "a zone change waits for its save, then continues with the saved state" |
| (Stage 6) Saves and deaths that failed during an outage were lost | `persistence.test.ts`: retries with backoff, deaths before final saves; `outage.integration.test.ts`: "leaving: the server keeps the lease until the final save is written" |
| (Stage 6) A new statement could hang forever while Postgres didn't answer (Prisma's timeout doesn't cover preparing it) | `isDatabaseUnavailable.test.ts`: `withDatabaseTimeout`; `outage.integration.test.ts` |
| (Stage 6) account-api answered 500 after 30 s, then 502 for everything (readiness tied to the database) | `accountApi.test.ts`: "answers 503 with a clear message, and stays ready" |
| (Stage 6) A Redis restart (empty) dropped every player | `ownership.test.ts`: "takes back a lease that vanished" |
| (Stage 7) After a node restart, a GameServer pod started before Linkerd's injector and ran without a proxy, outside the mesh: it never reached the orchestrator | `webhookFailurePolicy: Fail` (`infra/k8s/linkerd/values.yaml`); `pnpm cluster:smoke` step 10 |
| (Stage 7) In a region cut off from central, every zone change waited for a failing allocation | `fleetAgent.test.ts`: "knows whether the orchestrator is reachable"; `outage.integration.test.ts`: "Central unreachable" |

---

## Acceptance Tests

**Purpose:** decide whether a stage is done. Each stage in [`SERVER_INFRASTRUCTURE_PLAN.md`](SERVER_INFRASTRUCTURE_PLAN.md) lists acceptance criteria. They are checked with the tests above (often a chaos or load test), and the result is written next to each criterion.

---

## Continuous Integration (CI)

Every push to GitHub runs `.github/workflows/ci.yml`: install, dependency rules (`pnpm lint:deps`), build, `pnpm test` (unit, integration and multi-service tests) and `pnpm bench`. Smoke, load, soak and chaos tests need the Docker realm and a lot of time, so they are run by hand before finishing a stage (`pnpm chaos` at least once per stage that touches the fleet).

The cluster smoke test runs on demand only (`.github/workflows/cluster-smoke.yml`, ~30 min): it installs kind, kubectl, Helm and the Linkerd CLI, then runs `pnpm cluster:up`, `pnpm cluster:smoke`, `pnpm cluster:smoke --mode persistence`, `pnpm cluster:down` and `pnpm cluster-db:down -- --wipe`. Start it from the Actions tab ("Run workflow", once the workflow is on the default branch) or for any commit by pushing a tag:

```bash
git tag cluster-smoke-$(git rev-parse --short HEAD) && git push origin cluster-smoke-$(git rev-parse --short HEAD)
```

```bash
# What CI runs, locally
pnpm install --frozen-lockfile && pnpm lint:deps && pnpm build && pnpm test && pnpm bench
```

---

## Cleaning Up

```bash
# Stop the realm and delete its data
docker compose -f infra/compose/docker-compose.yml --profile realm down -v

# Delete the Kubernetes cluster (the images built for it stay: mmoexile/*:dev),
# then its databases with their data and the generated secrets
pnpm cluster:down
pnpm cluster-db:down -- --wipe
docker rmi $(docker images 'mmoexile/*' -q)
```
