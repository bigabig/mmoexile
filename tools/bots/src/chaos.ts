/**
 * Chaos test: breaks the running Docker realm on purpose while bots play,
 * measures how it recovers, and checks the Stage 3 failure criteria.
 * See TESTS.md ("Chaos Tests").
 *
 *   pnpm realm:up
 *   pnpm chaos                  # or: pnpm chaos -- --bots 100
 *
 * Experiments, in order:
 *   1. Restart the orchestrator with its Redis mirror deleted: the fleet must
 *      be rebuilt from heartbeats alone, and nobody may be disconnected.
 *   2. Kill the busiest instance server (docker kill): it must be marked dead
 *      within 10 s, get no new instances, and its players must log in again.
 *   3. Drain the next busiest server: its players move away without a kick,
 *      and the process exits with code 0.
 * Afterwards the realm is restored (stopped servers are started again).
 * Exits with 1 if any check fails.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createHttpClient,
  orchestratorApi,
  redisKeys,
  type ServerView,
} from "@mmoexile/contracts";
import { sleep } from "./bot.js";
import { Swarm } from "./swarm.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const apiUrl = arg("api", "http://localhost:8080/api");
const orchestratorUrl = arg("orchestrator", "http://localhost:3003");
const botCount = Number(arg("bots", "60"));
const composeFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../infra/compose/docker-compose.yml",
);

/** Heartbeat interval of the realm (instance-server default). */
const HEARTBEAT_MS = 2000;

// --- Helpers ---

const run = promisify(execFile);

async function compose(...args: string[]): Promise<string> {
  const { stdout } = await run("docker", ["compose", "-f", composeFile, "--profile", "realm", ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

const call = createHttpClient({ baseUrl: orchestratorUrl });

const orchestratorAnswers = () =>
  call(orchestratorApi.listServers, undefined).then(() => true, () => false);

async function fleet(): Promise<ServerView[]> {
  try {
    return (await call(orchestratorApi.listServers, undefined)).servers;
  } catch {
    return [];
  }
}

const describeFleet = (servers: ServerView[]) =>
  servers
    .slice()
    .sort((a, b) => a.serverId.localeCompare(b.serverId))
    .map((s) => `${s.serverId}=${s.state}:${s.players}`)
    .join(" ");

/** Polls until `check` holds; returns the elapsed milliseconds. */
async function waitFor(
  what: string,
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 100,
): Promise<number> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for: ${what}`);
    }
    await sleep(intervalMs);
  }
  return Date.now() - started;
}

/** Which compose service runs which SERVER_ID (instance-server-1 → s1, …). */
async function serviceByServerId(): Promise<Map<string, string>> {
  const config = JSON.parse(await compose("config", "--format", "json")) as {
    services: Record<string, { environment?: Record<string, string> }>;
  };
  const map = new Map<string, string>();
  for (const [service, definition] of Object.entries(config.services)) {
    const serverId = definition.environment?.SERVER_ID;
    if (serverId) map.set(serverId, service);
  }
  return map;
}

async function containerState(service: string): Promise<{ state: string; exitCode: number }> {
  const out = (await compose("ps", "-a", "--format", "json", service)).trim();
  const row = JSON.parse(out.split("\n")[0]) as { State: string; ExitCode: number };
  return { state: row.State, exitCode: row.ExitCode };
}

/** Orchestrator "Allocated" log lines since a point in time. */
async function allocationsSince(since: number): Promise<{ serverId: string; created: boolean; time: number }[]> {
  const logs = await compose("logs", "--no-log-prefix", "--since", new Date(since - 1000).toISOString(), "orchestrator");
  return logs
    .split("\n")
    .filter((line) => line.includes('"msg":"Allocated"'))
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.time >= since);
}

// --- Checks ---

interface Check {
  experiment: string;
  check: string;
  ok: boolean;
  value: string;
}
const checks: Check[] = [];

function record(experiment: string, check: string, ok: boolean, value: string): void {
  checks.push({ experiment, check, ok, value });
  console.log(`  ${ok ? "✔" : "✘"} ${check}: ${value}`);
}

function busiest(servers: ServerView[], exclude: string[] = []): ServerView | undefined {
  return servers
    .filter((s) => s.state === "ready" && !exclude.includes(s.serverId))
    .sort((a, b) => b.players - a.players)[0];
}

// --- Experiments ---

const services = await serviceByServerId();
const before = await fleet();
const ready = before.filter((s) => s.state === "ready");
if (ready.length < 3) {
  console.error(
    `The chaos test needs the Docker realm with 3 ready instance servers (found: ${describeFleet(before) || "no orchestrator"}).\nStart it with: pnpm realm:up`,
  );
  process.exit(1);
}

console.log(`Fleet: ${describeFleet(before)}`);
console.log(`Starting ${botCount} bots…`);
const swarm = new Swarm({ apiUrl, bots: botCount, route: ["nexus", "overworld"] });
swarm.start();
const stopped: string[] = [];

try {
  await waitFor("all bots online", () => swarm.online() === botCount, 120_000, 500);
  await sleep(10_000);
  console.log(`All bots playing. Fleet: ${describeFleet(await fleet())}\n`);

  // 1. Orchestrator restart, rebuilt from heartbeats only
  {
    const name = "Orchestrator restart";
    console.log(`1. ${name} (Redis mirror deleted)`);
    const readyIds = (await fleet()).filter((s) => s.state === "ready").map((s) => s.serverId);
    const counters = swarm.totals();
    await compose("stop", "orchestrator");
    await compose(
      "exec", "-T", "redis", "sh", "-c",
      `redis-cli --scan --pattern '${redisKeys.fleetServerPattern}' | xargs -r redis-cli del`,
    );
    await compose("start", "orchestrator");
    await waitFor("orchestrator answering", orchestratorAnswers, 60_000, 50);
    const rebuildMs = await waitFor(
      "registry rebuilt",
      async () => {
        const now = await fleet();
        return readyIds.every((id) => now.find((s) => s.serverId === id)?.state === "ready");
      },
      30_000,
      50,
    );
    record(name, "registry rebuilt from heartbeats within one interval", rebuildMs <= HEARTBEAT_MS + 500, `${rebuildMs} ms after it answered`);
    await sleep(10_000);
    const after = swarm.totals();
    record(name, "no player kicked or disconnected", after.kicks === counters.kicks && after.disconnects === counters.disconnects,
      `${after.kicks - counters.kicks} kicks, ${after.disconnects - counters.disconnects} disconnects`);
    console.log(`  Fleet: ${describeFleet(await fleet())}\n`);
  }

  // 2. Kill the busiest server
  {
    const name = "Server crash";
    const target = busiest(await fleet());
    if (!target) throw new Error("No ready server to kill");
    const service = services.get(target.serverId)!;
    console.log(`2. ${name}: docker kill ${service} (${target.serverId}, ${target.players} players)`);
    const killedAt = Date.now();
    await compose("kill", service);
    stopped.push(service);
    const deadMs = await waitFor(
      `${target.serverId} marked dead`,
      async () => (await fleet()).find((s) => s.serverId === target.serverId)?.state === "dead",
      30_000,
    );
    record(name, "marked dead within 10 s", deadMs <= 10_000, `${(deadMs / 1000).toFixed(1)} s`);

    await waitFor("all bots online again", () => swarm.online() === botCount, 90_000, 250);
    record(name, "its players logged in again elsewhere", true, `all ${botCount} bots online ${((Date.now() - killedAt) / 1000).toFixed(1)} s after the kill`);

    const allocations = await allocationsSince(killedAt);
    const created = allocations.filter((a) => a.serverId === target.serverId && a.created).length;
    const joined = allocations.filter((a) => a.serverId === target.serverId && !a.created);
    record(name, "no new instance created on it", created === 0, `${created} created`);
    const lastJoin = joined.at(-1);
    console.log(
      `  (info) ${joined.length} players were still sent to existing instances on it` +
        (lastJoin ? `, the last ${((lastJoin.time - killedAt) / 1000).toFixed(1)} s after the kill` : ""),
    );
    console.log(`  Fleet: ${describeFleet(await fleet())}\n`);
  }

  // 3. Drain the next busiest server
  {
    const name = "Drain";
    const target = busiest(await fleet());
    if (!target) throw new Error("No ready server to drain");
    const service = services.get(target.serverId)!;
    console.log(`3. ${name}: POST /servers/${target.serverId}/drain (${service}, ${target.players} players)`);
    const counters = swarm.totals();
    await call(orchestratorApi.drain, undefined, { path: `/servers/${target.serverId}/drain` });
    const exitMs = await waitFor(
      `${service} exited`,
      async () => (await containerState(service)).state === "exited",
      180_000,
      250,
    );
    stopped.push(service);
    const { exitCode } = await containerState(service);
    record(name, "process exited cleanly", exitCode === 0, `exit code ${exitCode} after ${(exitMs / 1000).toFixed(1)} s`);
    const state = (await fleet()).find((s) => s.serverId === target.serverId)?.state;
    record(name, "reported as stopped", state === "stopped", String(state));
    await sleep(5000);
    const after = swarm.totals();
    record(name, "players moved without kick or disconnect", after.kicks === counters.kicks && after.disconnects === counters.disconnects,
      `${after.kicks - counters.kicks} kicks, ${after.disconnects - counters.disconnects} disconnects`);
    console.log(`  Fleet: ${describeFleet(await fleet())}\n`);
  }
} catch (err) {
  record("Run", "experiments completed", false, (err as Error).message);
} finally {
  const report = await swarm.stop();
  console.log("Restoring the realm…");
  for (const service of stopped) await compose("start", service).catch(() => {});
  await waitFor(
    "all servers ready again",
    async () => (await fleet()).filter((s) => s.state === "ready").length >= ready.length,
    90_000,
    500,
  ).then(
    async () => console.log(`Fleet: ${describeFleet(await fleet())}\n`),
    (err) => record("Restore", "all servers ready again", false, (err as Error).message),
  );

  console.log("Bots:", JSON.stringify({
    hops: report.hops,
    kicks: report.kicks,
    disconnects: report.disconnects,
    failedHops: report.failedHops,
    botEventLoopLagMs: report.botEventLoopLagMs,
  }));
  record("Overall", "no player was kicked", report.kicks === 0, `${report.kicks} kicks`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${failed.length === 0 ? "PASSED" : "FAILED"}: ${checks.length - failed.length}/${checks.length} checks`);
  for (const c of failed) console.log(`  ✘ ${c.experiment}: ${c.check} (${c.value})`);
  process.exit(failed.length === 0 ? 0 : 1);
}
