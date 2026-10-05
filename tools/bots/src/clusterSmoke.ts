/**
 * Smoke test of the realm on the local Kubernetes cluster (Stage 5): plays
 * with bots while it scales, rolls out and loses a pod, and checks the
 * acceptance criteria. See TESTS.md ("Cluster Smoke Test").
 *
 *   pnpm cluster:up
 *   pnpm cluster:smoke
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
 * Steps 3-6 run with "observer" bots playing in eu the whole time.
 * Prints one line per check and exits with 1 if any failed.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createHttpClient,
  directoryApi,
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
const context = arg("context", "kind-mmoexile");
const loadBots = Number(arg("load", "70"));
const observerBots = Number(arg("observers", "10"));
const reloadScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../infra/k8s/scripts/reload.sh",
);

// --- Helpers ---

const run = promisify(execFile);

async function kubectl(...args: string[]): Promise<string> {
  const { stdout } = await run("kubectl", ["--context", context, "-n", "mmoexile", ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

interface FleetStatus {
  replicas: number;
  ready: number;
  allocated: number;
}

async function fleetStatus(name: string): Promise<FleetStatus> {
  const fleet = JSON.parse(await kubectl("get", "fleet", name, "-o", "json")) as {
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
async function autoscalerBounds(name: string): Promise<string> {
  return kubectl("get", "fleetautoscaler", name, "-o", "jsonpath={.spec.policy.counter.minCapacity}-{.spec.policy.counter.maxCapacity}");
}

async function gameServerNames(fleet: string): Promise<string[]> {
  const out = await kubectl("get", "gameservers", "-l", `agones.dev/fleet=${fleet}`, "-o", "jsonpath={.items[*].metadata.name}");
  return out.split(/\s+/).filter(Boolean);
}

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

// --- Checks ---

let observers: Swarm | undefined;
let load: Swarm | undefined;

try {
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

  observers = new Swarm({ apiUrl, region: "eu", bots: observerBots, route: ["nexus", "overworld"] });
  observers.start();
  await waitFor("observers online", () => observers!.online() === observerBots, 60_000);
  const initial = await fleetStatus("instance-server-eu");

  // 3. Scale up
  {
    console.log(`3. Scale up: ${loadBots} more bots in eu (fleet: ${initial.replicas} servers)`);
    const since = observers.totals();
    load = new Swarm({ apiUrl, region: "eu", bots: loadBots, route: ["nexus", "overworld"] });
    load.start();
    const ms = await waitFor(
      "eu fleet scaled up",
      async () => (await fleetStatus("instance-server-eu")).replicas > initial.replicas,
      240_000,
      2000,
    );
    const now = await fleetStatus("instance-server-eu");
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
      async () => (await fleetStatus("instance-server-eu")).replicas <= initial.replicas,
      300_000,
      2000,
    );
    record("the eu fleet scaled back down", true, `${(await fleetStatus("instance-server-eu")).replicas} servers after ${seconds(ms)}`);
    await sleep(10_000); // the removed servers drain and stop
    const observed = disruptions(observers, since);
    record("players stayed connected", observed.ok, observed.text);
  }

  // 5. Rolling update
  {
    console.log("5. Rolling update (pnpm cluster:reload instance-server)");
    const since = observers.totals();
    const before = new Set([...(await gameServerNames("instance-server-eu")), ...(await gameServerNames("instance-server-us"))]);
    const bounds = [await autoscalerBounds("instance-server-eu"), await autoscalerBounds("instance-server-us")];
    const started = Date.now();
    await run("bash", [reloadScript, "instance-server"], { maxBuffer: 64 * 1024 * 1024 });
    const after = [...(await gameServerNames("instance-server-eu")), ...(await gameServerNames("instance-server-us"))];
    record("every instance server replaced", after.length > 0 && after.every((name) => !before.has(name)),
      `${before.size} old → ${after.length} new in ${seconds(Date.now() - started)}`);
    const boundsAfter = [await autoscalerBounds("instance-server-eu"), await autoscalerBounds("instance-server-us")];
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
    await kubectl("exec", target.serverId, "-c", "instance-server", "--", "sh", "-c", "kill -9 -1").catch(() => {});
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
        const fleet = await fleetStatus("instance-server-eu");
        const names = await gameServerNames("instance-server-eu");
        return !names.includes(target.serverId) && fleet.ready + fleet.allocated >= fleet.replicas;
      },
      180_000,
      2000,
    );
    record("Agones replaced the GameServer", true, `fleet complete again ${seconds(Date.now() - killedAt)} after the crash (${seconds(replacedMs)} of waiting)`);
  }
} catch (err) {
  record("smoke test completed", false, (err as Error).message);
} finally {
  await load?.stop();
  const report = await observers?.stop();
  if (report) console.log(`Observers: ${report.welcomes} welcomes, ${report.kicks} kicks, ${report.disconnects} disconnects, ${report.errors} errors`);
}

console.log(failed === 0 ? "\nAll checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
