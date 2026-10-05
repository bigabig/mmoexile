/**
 * Smoke test of the realm on the local Kubernetes clusters (Stages 5-7):
 * plays with bots while it scales, rolls out, loses a pod, its databases,
 * a region's cluster and the link to a region, and checks the acceptance
 * criteria. See TESTS.md ("Cluster Smoke Test").
 *
 *   pnpm cluster:up
 *   pnpm cluster:smoke
 *   pnpm cluster:smoke --mode persistence   (the data outlives the
 *                                            databases' and the clusters'
 *                                            restart, ~10 min)
 *   pnpm cluster:smoke --mode failures      (only steps 10 and 11)
 *
 * Checks, in order:
 *   1. The realm is reachable and both regions answer pings (us farther).
 *   2. Bots play in each region, on that region's servers.
 *   3. Under load, the eu fleet scales up; nobody is kicked.
 *   4. After the load, it scales back down; players stay connected.
 *   5. A rolling update of the instance servers (pnpm cluster:reload
 *      instance-server) moves players without a kick.
 *   6. A crashed instance server: the orchestrator marks it dead, Agones
 *      replaces it, and its players log in again.
 *   7. The databases: TLS only, certificates from another CA rejected, the
 *      services' database user can't change the schema.
 *   8. Postgres unavailable for 30 s: nobody is kicked, logins get a clear
 *      503, every save is written afterwards.
 *   9. Redis unavailable for 10 s: nobody is kicked.
 *  10. The us cluster lost (its node killed), then back: the orchestrator
 *      marks its servers dead, logins into us get a clear 503, eu plays on
 *      undisturbed, us recovers on its own and its players log in again.
 *  11. us cut off from central for 30 s (iptables on both nodes): nobody
 *      in us is kicked, zone changes there are refused with a notice,
 *      logins into us get a clear 503; afterwards everything recovers.
 *  12. The mesh: calls between services are mTLS; callers outside the mesh
 *      and meshed callers without permission are refused.
 * Steps 3-11 run with "observer" bots playing in eu the whole time, steps
 * 10-11 also with observers in us.
 * Prints one line per check and exits with 1 if any failed.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  accountApi,
  createHttpClient,
  directoryApi,
  HttpError,
  measureRegions,
  orchestratorApi,
  type ServerView,
} from "@mmoexile/contracts";
import { sleep } from "./bot.js";
import { directoryNextTo } from "./regions.js";
import { Swarm, type SwarmReport } from "./swarm.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const apiUrl = arg("api", "http://localhost:8090/api");
const orchestratorUrl = arg("orchestrator", "http://localhost:3013");
// kubectl context of a cluster: <prefix><cluster>, e.g. kind-mmoexile-eu
const contextPrefix = arg("context-prefix", "kind-mmoexile-");
const loadBots = Number(arg("load", "70"));
const observerBots = Number(arg("observers", "10"));
const prometheusUrl = arg("prometheus", "http://localhost:9091");
const mode = arg("mode", "realm");
const k8sDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../infra/k8s");
const reloadScript = path.join(k8sDir, "scripts/reload.sh");
const secret = (name: string) => readFileSync(path.join(k8sDir, ".secrets", name), "utf8").trim();

// --- Helpers ---

const run = promisify(execFile);

/** kubectl in the realm's namespace of one cluster (central, eu, us). */
async function kubectl(cluster: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("kubectl", ["--context", contextPrefix + cluster, "-n", "mmoexile", ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

interface FleetStatus {
  replicas: number;
  ready: number;
  allocated: number;
}

/** A region's Fleet (instance-server-<region>, in the region's cluster). */
async function fleetStatus(region: string): Promise<FleetStatus> {
  const fleet = JSON.parse(await kubectl(region, "get", "fleet", `instance-server-${region}`, "-o", "json")) as {
    spec: { replicas: number };
    status?: { readyReplicas?: number; allocatedReplicas?: number };
  };
  return {
    replicas: fleet.spec.replicas,
    ready: fleet.status?.readyReplicas ?? 0,
    allocated: fleet.status?.allocatedReplicas ?? 0,
  };
}

/** The FleetAutoscaler's bounds, e.g. "120-240". */
async function autoscalerBounds(region: string): Promise<string> {
  return kubectl(region, "get", "fleetautoscaler", `instance-server-${region}`, "-o", "jsonpath={.spec.policy.counter.minCapacity}-{.spec.policy.counter.maxCapacity}");
}

async function gameServerNames(region: string): Promise<string[]> {
  const out = await kubectl(region, "get", "gameservers", "-l", `agones.dev/fleet=instance-server-${region}`, "-o", "jsonpath={.items[*].metadata.name}");
  return out.split(/\s+/).filter(Boolean);
}

// --- The databases next to the cluster (cluster-db-up.sh) ---

const dbContainer = (service: string) => `mmoexile-db-${service}`;
const paused = new Set<string>();
async function pause(service: string): Promise<void> {
  await run("docker", ["pause", dbContainer(service)]);
  paused.add(service);
}
async function unpause(service: string): Promise<void> {
  await run("docker", ["unpause", dbContainer(service)]);
  paused.delete(service);
}

/**
 * Runs a client in a throwaway container on kind's network, like a pod
 * would connect; returns its output (also when it fails). Passwords go
 * through the environment.
 */
async function client(image: string, command: string[], env: Record<string, string> = {}, mounts: string[] = []) {
  const args = ["run", "--rm", "--network", "kind", ...Object.keys(env).flatMap((name) => ["-e", name]),
    ...mounts.flatMap((m) => ["-v", m]), image, ...command];
  try {
    const { stdout, stderr } = await run("docker", args, { env: { ...process.env, ...env } });
    return `${stdout}${stderr}`;
  } catch (err) {
    const { stdout = "", stderr = "" } = err as { stdout?: string; stderr?: string };
    return `${stdout}${stderr}`;
  }
}
const psql = (conninfo: string, sql: string, password: string, mounts: string[] = []) =>
  client("postgres:16", ["psql", conninfo, "-tAc", sql], { PGPASSWORD: password }, mounts);

async function prometheus(query: string): Promise<number | undefined> {
  const res = await fetch(`${prometheusUrl}/api/v1/query?${new URLSearchParams({ query })}`);
  const { data } = (await res.json()) as { data: { result: { value: [number, string] }[] } };
  return data.result[0] ? Number(data.result[0].value[1]) : undefined;
}

const firstLine = (text: string) => text.trim().split("\n").find((l) => l.trim())?.trim().slice(0, 110) ?? "";

const orchestrator = createHttpClient({ baseUrl: orchestratorUrl });

async function servers(): Promise<ServerView[]> {
  try {
    return (await orchestrator(orchestratorApi.listServers, undefined)).servers;
  } catch {
    return [];
  }
}

/** Polls until `check` holds; returns the elapsed milliseconds. */
async function waitFor(
  what: string,
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 500,
): Promise<number> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs / 1000} s waiting for: ${what}`);
    }
    await sleep(intervalMs);
  }
  return Date.now() - started;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

let failed = 0;
function record(check: string, ok: boolean, value: string): void {
  if (!ok) failed++;
  console.log(`  ${ok ? "✔" : "✘"} ${check}: ${value}`);
}

/** Kicks and disconnects since a snapshot of a swarm's counters. */
function disruptions(swarm: Swarm, since: ReturnType<Swarm["totals"]>) {
  const now = swarm.totals();
  const kicks = now.kicks - since.kicks;
  const disconnects = now.disconnects - since.disconnects;
  return { ok: kicks === 0 && disconnects === 0, text: `${kicks} kicks, ${disconnects} disconnects` };
}

// --- Failure scenarios across clusters (Stage 7) ---

const nodeContainer = (cluster: string) => `mmoexile-${cluster}-control-plane`;

async function containerIp(name: string): Promise<string> {
  const { stdout } = await run("docker", ["inspect", "-f", '{{(index .NetworkSettings.Networks "kind").IPAddress}}', name]);
  return stdout.trim();
}

/** The address of a cluster's multicluster gateway (its LoadBalancer). */
async function gatewayIp(cluster: string): Promise<string> {
  const ip = await kubectl(cluster, "-n", "linkerd-multicluster", "get", "svc", "linkerd-gateway",
    "-o", "jsonpath={.status.loadBalancer.ingress[0].ip}");
  return ip.trim();
}

/** The us cluster's simulated distance (cluster-up.sh); a restarted node loses it. */
const usLatencyMs = Number(process.env.US_LATENCY_MS ?? 40);
const delayUs = () =>
  run("docker", ["exec", nodeContainer("us"), "tc", "qdisc", "replace", "dev", "eth0", "root", "netem", "delay", `${usLatencyMs}ms`]);

let stoppedNode: string | undefined;
/** iptables rules cutting central off from a region: [node, destination dropped]. */
let cutRules: [string, string][] = [];

async function dropTraffic(action: "-I" | "-D", node: string, destination: string): Promise<void> {
  // OUTPUT: the node itself (its API server, host-network pods); FORWARD: its pods
  for (const chain of ["OUTPUT", "FORWARD"]) {
    await run("docker", ["exec", node, "iptables", action, chain, "-d", destination, "-j", "DROP"]);
  }
}

/**
 * Cuts a region off from central, in both directions: each side's node
 * drops what it sends to the other's node (API server) and multicluster
 * gateway. Players (host ports, pings) and the databases are unaffected.
 */
async function cutOff(region: string): Promise<void> {
  const central = nodeContainer("central");
  const node = nodeContainer(region);
  cutRules = [
    [node, await containerIp(central)],
    [node, await gatewayIp("central")],
    [central, await containerIp(node)],
    [central, await gatewayIp(region)],
  ];
  for (const [n, destination] of cutRules) await dropTraffic("-I", n, destination);
}

async function reconnect(): Promise<void> {
  for (const [n, destination] of cutRules) await dropTraffic("-D", n, destination);
  cutRules = [];
}

/** A fresh guest's login into a region: "ok" or "<status> <reason>". */
async function tryLogin(region: string): Promise<string> {
  let token: string | undefined;
  const api = createHttpClient({ baseUrl: apiUrl, token: () => token });
  try {
    token = (await api(accountApi.guestLogin, { nickname: "Probe" })).sessionToken;
    const { character } = await api(accountApi.createCharacter, { classId: "knight" });
    await api(accountApi.play, { characterId: character.id, region });
    return "ok";
  } catch (err) {
    return err instanceof HttpError ? `${err.status} ${err.reason ?? err.message}` : String(err);
  }
}

const regionServers = async (region: string) => (await servers()).filter((s) => s.region === region);

// --- Checks ---

let observers: Swarm | undefined;
let load: Swarm | undefined;

/** A fresh guest with a character; returns what is needed to find it again. */
async function newCharacter() {
  let token: string | undefined;
  const api = createHttpClient({ baseUrl: apiUrl, token: () => token });
  const login = await api(accountApi.guestLogin, { nickname: "Keeper" });
  token = login.sessionToken;
  const { character } = await api(accountApi.createCharacter, { classId: "knight" });
  return { refreshSecret: login.refreshSecret, characterId: character.id };
}

/** Logs in again with the refresh secret: is the character still there? */
async function stillThere(saved: { refreshSecret: string; characterId: string }): Promise<string> {
  let token: string | undefined;
  const api = createHttpClient({ baseUrl: apiUrl, token: () => token });
  for (let attempt = 0; ; attempt++) {
    try {
      token = (await api(accountApi.refresh, { refreshSecret: saved.refreshSecret })).sessionToken;
      const { characters } = await api(accountApi.listCharacters, undefined);
      return characters.some((c) => c.id === saved.characterId) ? "found" : "character missing";
    } catch (err) {
      if (attempt >= 30) return `login failed: ${(err as Error).message}`;
      await sleep(2000); // the realm is still starting
    }
  }
}

async function script(name: string, ...args: string[]): Promise<number> {
  const started = Date.now();
  await run("bash", [path.join(k8sDir, "scripts", name), ...args], { maxBuffer: 256 * 1024 * 1024 });
  return Date.now() - started;
}

if (mode === "persistence") {
  try {
    console.log("Data outlives the databases' and the clusters' restart");
    const saved = await newCharacter();
    console.log(`  character ${saved.characterId}; pnpm cluster-db:down, cluster-db:up`);
    const dbMs = (await script("cluster-db-down.sh")) + (await script("cluster-db-up.sh"));
    const afterDb = await stillThere(saved);
    record("still there after the databases restarted", afterDb === "found", `${afterDb} (databases back after ${seconds(dbMs)})`);
    console.log("  pnpm cluster:down, cluster:up");
    const clusterMs = (await script("cluster-down.sh")) + (await script("cluster-up.sh"));
    const afterCluster = await stillThere(saved);
    record("still there after the clusters were deleted and created again", afterCluster === "found",
      `${afterCluster} (clusters back after ${seconds(clusterMs)})`);
  } catch (err) {
    record("persistence check completed", false, (err as Error).message);
  }
  console.log(failed === 0 ? "\nAll checks passed" : `\n${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

try {
  if (mode === "realm") {
    // 1. Reachability
    {
      console.log("1. Reachable");
      const directory = createHttpClient({ baseUrl: directoryNextTo(apiUrl) });
      const { realms } = await directory(directoryApi.listRealms, undefined);
      const regions = await measureRegions(realms[0]?.regions ?? []);
      const text = regions.map((r) => `${r.id}=${r.pingMs ?? "unreachable"}${r.pingMs !== undefined ? " ms" : ""}`).join(", ");
      record("the directory lists eu and us, both answer pings", ["eu", "us"].every((id) => regions.some((r) => r.id === id && r.pingMs !== undefined)), text);
      const eu = regions.find((r) => r.id === "eu")?.pingMs ?? 0;
      const us = regions.find((r) => r.id === "us")?.pingMs ?? 0;
      record("us is farther away than eu (simulated distance)", us - eu >= 20, `${us - eu} ms`);
    }

    // 2. Bots in each region
    {
      console.log("2. Bots play in each region");
      const swarms = ["eu", "us"].map((region) => ({
        region,
        swarm: new Swarm({ apiUrl, region, bots: 5, route: ["nexus", "overworld", "golem_dungeon"] }),
      }));
      swarms.forEach(({ swarm }) => swarm.start());
      await sleep(30_000);
      const regionOf = new Map((await servers()).map((s) => [s.url, s.region]));
      for (const { region, swarm } of swarms) {
        const report: SwarmReport = await swarm.stop();
        const foreign = Object.keys(report.welcomesPerServer).filter((url) => regionOf.get(url) !== region);
        record(
          `${region}: played on ${region} servers without kicks or errors`,
          report.welcomes > 0 && report.kicks === 0 && report.errors === 0 && foreign.length === 0,
          `${report.welcomes} welcomes on ${Object.keys(report.welcomesPerServer).length} servers, ${report.kicks} kicks, ${report.errors} errors` +
            (foreign.length ? `, foreign servers: ${foreign.join(" ")}` : ""),
        );
      }
    }
  }

  observers = new Swarm({ apiUrl, region: "eu", bots: observerBots, route: ["nexus", "overworld"] });
  observers.start();
  await waitFor("observers online", () => observers!.online() === observerBots, 60_000);
  const initial = await fleetStatus("eu");

  if (mode === "realm") {
    // 3. Scale up
    {
      console.log(`3. Scale up: ${loadBots} more bots in eu (fleet: ${initial.replicas} servers)`);
      const since = observers.totals();
      load = new Swarm({ apiUrl, region: "eu", bots: loadBots, route: ["nexus", "overworld"] });
      load.start();
      const ms = await waitFor(
        "eu fleet scaled up",
        async () => (await fleetStatus("eu")).replicas > initial.replicas,
        240_000,
        2000,
      );
      const now = await fleetStatus("eu");
      record("the eu fleet scaled up", true, `${initial.replicas} → ${now.replicas} servers after ${seconds(ms)}`);
      await sleep(15_000);
      const loadTotals = load.totals();
      const observed = disruptions(observers, since);
      record("nobody kicked under load", observed.ok && loadTotals.kicks === 0,
        `observers: ${observed.text}; load: ${loadTotals.kicks} kicks, ${loadTotals.errors} errors`);
    }

    // 4. Scale down
    {
      console.log("4. Scale down: the load leaves");
      const loadReport = await load.stop();
      load = undefined;
      // Not a failure: a burst bigger than the autoscaler's buffer fills the
      // region until the new server is up ("region_unavailable" meanwhile)
      console.log(`  (info) load bots: ${loadReport.failedHops} failed hops while eu was full, ${loadReport.kicks} kicks`);
      const since = observers.totals();
      const ms = await waitFor(
        "eu fleet back to its size",
        async () => (await fleetStatus("eu")).replicas <= initial.replicas,
        300_000,
        2000,
      );
      record("the eu fleet scaled back down", true, `${(await fleetStatus("eu")).replicas} servers after ${seconds(ms)}`);
      await sleep(10_000); // the removed servers drain and stop
      const observed = disruptions(observers, since);
      record("players stayed connected", observed.ok, observed.text);
    }

    // 5. Rolling update
    {
      console.log("5. Rolling update (pnpm cluster:reload instance-server)");
      const since = observers.totals();
      const before = new Set([...(await gameServerNames("eu")), ...(await gameServerNames("us"))]);
      const bounds = [await autoscalerBounds("eu"), await autoscalerBounds("us")];
      const started = Date.now();
      await run("bash", [reloadScript, "instance-server"], { maxBuffer: 64 * 1024 * 1024 });
      const after = [...(await gameServerNames("eu")), ...(await gameServerNames("us"))];
      record("every instance server replaced", after.length > 0 && after.every((name) => !before.has(name)),
        `${before.size} old → ${after.length} new in ${seconds(Date.now() - started)}`);
      const boundsAfter = [await autoscalerBounds("eu"), await autoscalerBounds("us")];
      record("the autoscalers' bounds are back", boundsAfter.join() === bounds.join(), `eu ${boundsAfter[0]}, us ${boundsAfter[1]} slots`);
      await sleep(5_000);
      const observed = disruptions(observers, since);
      record("players moved without a kick", observed.ok, observed.text);
    }

    // 6. Crash
    {
      const target = (await servers())
        .filter((s) => s.region === "eu" && s.state === "ready")
        .sort((a, b) => b.players - a.players)[0];
      if (!target) throw new Error("No ready eu server to crash");
      console.log(`6. Crash: kill -9 in ${target.serverId} (${target.players} players)`);
      const killedAt = Date.now();
      // Every process of the container except PID 1 (tsx), which then exits too
      await kubectl("eu", "exec", target.serverId, "-c", "instance-server", "--", "sh", "-c", "kill -9 -1").catch(() => {});
      const deadMs = await waitFor(
        `${target.serverId} marked dead`,
        async () => (await servers()).find((s) => s.serverId === target.serverId)?.state === "dead",
        30_000,
      );
      record("the orchestrator marked it dead within 10 s", deadMs <= 10_000, seconds(deadMs));
      const onlineMs = await waitFor("observers online again", () => observers!.online() === observerBots, 90_000);
      record("its players logged in again", true, `all ${observerBots} observers online after ${seconds(onlineMs + deadMs)}`);
      const replacedMs = await waitFor(
        "Agones replaced it",
        async () => {
          const fleet = await fleetStatus("eu");
          const names = await gameServerNames("eu");
          return !names.includes(target.serverId) && fleet.ready + fleet.allocated >= fleet.replicas;
        },
        180_000,
        2000,
      );
      record("Agones replaced the GameServer", true, `fleet complete again ${seconds(Date.now() - killedAt)} after the crash (${seconds(replacedMs)} of waiting)`);
    }

    // 7. TLS and least privilege
    {
      console.log("7. The databases: TLS, certificates, least privilege");
      const app = secret("postgres-app-password");
      const migrate = secret("postgres-migrate-password");
      const refused = [
        await psql("host=mmoexile-db-postgres dbname=mmoexile user=mmoexile_migrate sslmode=disable", "select 1", migrate),
        await psql("host=mmoexile-db-postgres port=6432 dbname=mmoexile user=mmoexile_app sslmode=disable", "select 1", app),
        await client("redis:7", ["redis-cli", "-h", dbContainer("redis"), "-p", "6380", "ping"]),
      ];
      record("connections without TLS are refused (Postgres, PgBouncer, Redis)",
        /no encryption/.test(refused[0]) && /SSL required/.test(refused[1]) && !/PONG/.test(refused[2]),
        refused.map(firstLine).join(" | "));

      // A CA of our own: the servers' certificates aren't signed by it
      const dir = mkdtempSync(path.join(os.tmpdir(), "other-ca-"));
      try {
        await run("openssl", ["req", "-x509", "-new", "-nodes", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
          "-keyout", path.join(dir, "ca.key"), "-out", path.join(dir, "ca.crt"), "-days", "1", "-subj", "/CN=another CA"]);
        const mount = [`${dir}/ca.crt:/other/ca.crt:ro`];
        const pg = await psql("host=mmoexile-db-postgres dbname=mmoexile user=mmoexile_migrate sslmode=verify-full sslrootcert=/other/ca.crt",
          "select 1", migrate, mount);
        const redis = await client("redis:7", ["redis-cli", "-h", dbContainer("redis"), "-p", "6380", "--tls", "--cacert", "/other/ca.crt", "ping"], {}, mount);
        record("a server certificate from another CA is rejected", /certificate verify failed/.test(pg) && !/PONG/.test(redis),
          `${firstLine(pg)} | ${firstLine(redis)}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }

      // The services' user, through PgBouncer like the pods
      const conninfo = "host=mmoexile-db-postgres port=6432 dbname=mmoexile user=mmoexile_app sslmode=require";
      const reads = await psql(conninfo, `select count(*) from "Character"`, app);
      const drop = await psql(conninfo, `drop table "Character"`, app);
      record("the services' database user reads data but can't change the schema",
        /^\d+$/.test(reads.trim()) && /must be owner/.test(drop), `${reads.trim()} characters | ${firstLine(drop)}`);
    }

    // 8. Postgres outage
    {
      const outageMs = 30_000;
      console.log(`8. Postgres unavailable for ${outageMs / 1000} s (docker pause)`);
      await waitFor("observers online", () => observers!.online() === observerBots, 90_000);
      const since = observers.totals();
      const failuresBefore = (await prometheus("sum(mmoexile_character_save_failures_total)")) ?? 0;
      await pause("postgres");
      const pausedAt = Date.now();
      await sleep(3000);
      const loginStarted = Date.now();
      const login = await createHttpClient({ baseUrl: apiUrl })(accountApi.guestLogin, { nickname: "Outage" }).then(
        () => "login succeeded",
        (err: unknown) => (err instanceof HttpError ? `${err.status} ${err.message}` : String(err)),
      );
      const loginMs = Date.now() - loginStarted;
      await sleep(Math.max(0, outageMs - (Date.now() - pausedAt)));
      await unpause("postgres");
      record("logins during the outage get a clear error", /^503 .*unavailable/.test(login), `${login} after ${seconds(loginMs)}`);
      const caughtUpMs = await waitFor("saves written", async () => (await prometheus("sum(mmoexile_character_saves_pending)")) === 0, 60_000, 1000);
      const failures = ((await prometheus("sum(mmoexile_character_save_failures_total)")) ?? 0) - failuresBefore;
      record("every save waiting for the database was written afterwards", true,
        `${failures} failed writes retried, none waiting ${seconds(caughtUpMs)} after the outage`);
      await sleep(5000);
      const observed = disruptions(observers, since);
      record("nobody kicked during the Postgres outage", observed.ok, observed.text);
    }

    // 9. Redis outage
    {
      const outageMs = 10_000;
      console.log(`9. Redis unavailable for ${outageMs / 1000} s (docker pause)`);
      const since = observers.totals();
      await pause("redis");
      await sleep(outageMs);
      await unpause("redis");
      await sleep(10_000);
      const observed = disruptions(observers, since);
      record("nobody kicked during the Redis outage", observed.ok, observed.text);
    }
  }

  // 10. A region's cluster lost
  const usObservers = new Swarm({ apiUrl, region: "us", bots: observerBots, route: ["nexus", "overworld"] });
  {
    console.log("10. The us cluster lost (docker kill of its node), then back");
    usObservers.start();
    await waitFor("us observers online", () => usObservers.online() === observerBots, 90_000);
    const euSince = observers.totals();
    // Killed, not stopped: nothing shuts down cleanly, like a lost machine
    stoppedNode = nodeContainer("us");
    const stoppedAt = Date.now();
    await run("docker", ["kill", stoppedNode]);
    await waitFor("us servers marked dead", async () => (await regionServers("us")).every((s) => s.state !== "ready"), 60_000);
    const deadMs = Date.now() - stoppedAt;
    record("the orchestrator marked the us servers dead within 10 s", deadMs <= 10_000, `${seconds(deadMs)} after the kill`);
    const login = await tryLogin("us");
    record("logins into us get a clear error", login === "503 region_unavailable", login);
    await sleep(15_000);
    const eu = disruptions(observers, euSince);
    record("eu plays on undisturbed", eu.ok, eu.text);

    await run("docker", ["start", stoppedNode]);
    stoppedNode = undefined;
    const startedAt = Date.now();
    await delayUs();
    const readyMs = await waitFor("a us server ready again",
      async () => (await regionServers("us")).some((s) => s.state === "ready"), 300_000, 2000);
    const loginMs = await waitFor("logins into us work again", async () => (await tryLogin("us")) === "ok", 300_000, 2000);
    record("us recovers on its own", true,
      `a server ready ${seconds(readyMs)} after the node started, logins work after ${seconds(readyMs + loginMs)}`);
    const onlineMs = await waitFor("us observers online again", () => usObservers.online() === observerBots, 180_000);
    record("players who were in us log in again", true,
      `all ${observerBots} online ${seconds(Date.now() - startedAt)} after the node started (${seconds(onlineMs)} after logins worked)`);
  }

  // 11. A region cut off from central
  {
    const cutMs = 30_000;
    console.log(`11. us cut off from central for ${cutMs / 1000} s (iptables on both nodes)`);
    await waitFor("us servers ready", async () => (await regionServers("us")).some((s) => s.state === "ready"), 60_000);
    const euSince = observers.totals();
    const usSince = usObservers.totals();
    await cutOff("us");
    const cutAt = Date.now();
    const deadMs = await waitFor("us servers marked dead",
      async () => (await regionServers("us")).every((s) => s.state !== "ready"), 60_000);
    record("the orchestrator marked the us servers dead", true, `${seconds(deadMs)} after the cut`);
    const login = await tryLogin("us");
    record("logins into us get a clear error", login === "503 region_unavailable", login);
    await sleep(Math.max(0, cutMs - (Date.now() - cutAt)));
    const during = usObservers.totals();
    const us = disruptions(usObservers, usSince);
    record("nobody in us was kicked while cut off", us.ok, us.text);
    record("zone changes in us were refused with a message", during.refusals > usSince.refusals,
      `${during.refusals - usSince.refusals} refusals (one message per player every 3 s), ${during.hops - usSince.hops} zone changes done`);

    await reconnect();
    const backMs = await waitFor("us servers ready again",
      async () => (await regionServers("us")).some((s) => s.state === "ready"), 60_000);
    const hopsBefore = usObservers.totals().hops;
    // New instances in us need central → us through the mesh again, which
    // takes a little longer than the heartbeats (the link's probes)
    const hopsMs = await waitFor("zone changes in us work again", () => usObservers.totals().hops > hopsBefore + observerBots, 120_000);
    record("everything recovers when the link is back", true,
      `us servers ready ${seconds(backMs)} after, zone changes again ${seconds(backMs + hopsMs)} after`);
    const after = disruptions(usObservers, usSince);
    record("nobody in us was kicked at all", after.ok, after.text);
    const eu = disruptions(observers, euSince);
    record("eu plays on undisturbed", eu.ok, eu.text);
  }
  await usObservers.stop();

  // 12. The mesh
  if (mode === "realm") {
    console.log("12. The mesh: mTLS between services, only the intended calls");
    // Every request the orchestrator's proxy let in on its fleet and
    // allocation routes, by whether it came with mTLS (Linkerd's metrics)
    const routes = 'srv_name="orchestrator", route_name=~"orchestrator-(fleet|allocate)"';
    const mtls = (await prometheus(`sum(inbound_http_authz_allow_total{${routes}, tls="true"})`)) ?? 0;
    const plain = (await prometheus(`sum(inbound_http_authz_allow_total{${routes}, tls!="true"})`)) ?? 0;
    record("calls between services are mTLS", mtls > 0 && plain === 0,
      `orchestrator (register, heartbeat, allocate): ${mtls} requests with mTLS, ${plain} without`);
    const post = (url: string) =>
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.status);
    const fromHost = await post(`${orchestratorUrl}/allocate`);
    record("a caller outside the mesh is refused", fromHost === 403, `POST /allocate from the host: ${fromHost}`);
    const fromSocial = (await kubectl("central", "exec", "deploy/social", "-c", "social", "--", "node", "-e",
      'fetch("http://orchestrator:3003/allocate", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => console.log(r.status))')).trim();
    record("a meshed caller without permission is refused", fromSocial === "403", `POST /allocate from social: ${fromSocial}`);
    const drain = await post(`${orchestratorUrl}/servers/any/drain`);
    record("an operator action is not reachable through the mesh", drain === 404, `POST /servers/<id>/drain from the host: ${drain}`);
  }
} catch (err) {
  record("smoke test completed", false, (err as Error).message);
} finally {
  for (const service of paused) await unpause(service).catch(() => {});
  if (stoppedNode) await run("docker", ["start", stoppedNode]).then(delayUs).catch(() => {});
  await reconnect().catch(() => {});
  await load?.stop();
  const report = await observers?.stop();
  if (report) console.log(`Observers: ${report.welcomes} welcomes, ${report.kicks} kicks, ${report.disconnects} disconnects, ${report.errors} errors`);
}

console.log(failed === 0 ? "\nAll checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
