/**
 * Soak test: N bots travel a route of zones for a while and report handoffs,
 * kicks, errors and where they were placed. Dead characters are replaced.
 *
 *   pnpm --filter @mmoexile/bots hop -- --bots 20 --minutes 2 --api http://localhost:8080/api
 *
 * --route nexus,overworld (default) hops between the hubs; with
 * --route nexus,overworld,golem_dungeon every bot also opens its own dungeon
 * instance, which shows how the orchestrator spreads new instances.
 */
import { Bot, sleep } from "./bot.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const apiUrl = arg("api", "http://localhost:8080/api");
const botCount = Number(arg("bots", "10"));
const minutes = Number(arg("minutes", "1"));
const deadline = Date.now() + minutes * 60_000;
const route = arg("route", "nexus,overworld").split(",");
const run = Math.floor(Math.random() * 1e4);

const summary = { hops: 0, deaths: 0, failures: [] as string[] };

/** Logs in again until it works (or the run is over). */
async function rejoin(bot: Bot): Promise<void> {
  while (Date.now() < deadline) {
    try {
      await bot.ensureCharacter();
      await bot.play();
      if (!bot.kicked && !bot.disconnected) return;
      summary.failures.push(`${bot.name} rejoin ${bot.kicked ? `kicked: ${bot.kicked}` : "disconnected"}`);
    } catch (err) {
      summary.failures.push(`${bot.name} rejoin failed: ${(err as Error).message}`);
    }
    await sleep(1000);
  }
}

async function hopper(index: number): Promise<Bot> {
  const bot = new Bot({ apiUrl, name: `Hop${run}x${index}` });
  await bot.signIn();
  await rejoin(bot);
  while (Date.now() < deadline) {
    const here = route.indexOf(bot.zoneId);
    const target = route[(here + 1) % route.length];
    try {
      await bot.travelTo(target);
      summary.hops++;
    } catch (err) {
      if (bot.hp <= 0) summary.deaths++;
      else summary.failures.push((err as Error).message);
      if (bot.hp <= 0 || bot.kicked || bot.disconnected) {
        // Permadeath, kick or lost server: get a (new) character and start over
        await rejoin(bot);
      }
    }
    await sleep(250);
  }
  bot.disconnect();
  return bot;
}

// The bots' own event loop lag: if this process is overloaded, timeouts
// measure the load generator rather than the servers.
const lagSamples: number[] = [];
let lastTick = performance.now();
const lagTimer = setInterval(() => {
  const now = performance.now();
  lagSamples.push(now - lastTick - 500);
  lastTick = now;
}, 500);

const started = Date.now();
console.log(`${botCount} bots travelling ${route.join(" → ")} for ${minutes} min against ${apiUrl}`);
const bots = await Promise.all(
  Array.from({ length: botCount }, (_, i) => sleep(i * 150).then(() => hopper(i))),
);
const totals = bots.reduce(
  (t, b) => ({
    welcomes: t.welcomes + b.stats.welcomes,
    reconnects: t.reconnects + b.stats.reconnects,
    kicks: t.kicks + b.stats.kicks,
    errors: t.errors + b.stats.errors,
    disconnects: t.disconnects + b.stats.disconnects,
  }),
  { welcomes: 0, reconnects: 0, kicks: 0, errors: 0, disconnects: 0 },
);
clearInterval(lagTimer);
lagSamples.sort((a, b) => a - b);
const placements: Record<string, number> = {};
for (const bot of bots) {
  for (const [url, count] of bot.servers) placements[url] = (placements[url] ?? 0) + count;
}
console.log(
  JSON.stringify(
    {
      seconds: Math.round((Date.now() - started) / 1000),
      hops: summary.hops,
      // Killed by monsters on the way (permadeath; a new character continues)
      deaths: summary.deaths,
      ...totals,
      welcomesPerServer: placements,
      failedHops: summary.failures.length,
      botEventLoopLagMs: {
        p95: Math.round(lagSamples[Math.floor(lagSamples.length * 0.95)] ?? 0),
        max: Math.round(lagSamples.at(-1) ?? 0),
      },
      failureSamples: summary.failures.slice(0, 5),
    },
    null,
    2,
  ),
);
process.exit(0);
