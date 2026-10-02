/**
 * Soak test: N bots hop between the nexus and the overworld for a while and
 * report handoffs, kicks and errors. Dead characters are replaced.
 *
 *   pnpm --filter @mmoexile/bots hop -- --bots 20 --minutes 2 --api http://localhost:8080/api
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
const run = Math.floor(Math.random() * 1e4);

const summary = { hops: 0, failures: [] as string[] };

async function hopper(index: number): Promise<Bot> {
  const bot = new Bot({ apiUrl, name: `Hop${run}x${index}` });
  await bot.signIn();
  await bot.play();
  while (Date.now() < deadline) {
    const target = bot.zoneId === "nexus" ? "overworld" : "nexus";
    try {
      await bot.travelTo(target);
      summary.hops++;
    } catch (err) {
      summary.failures.push((err as Error).message);
      if (bot.hp <= 0 || bot.kicked) {
        // Permadeath or kick: get a (new) character and start over
        await bot.ensureCharacter();
        await bot.play();
      }
    }
    await sleep(250);
  }
  bot.disconnect();
  return bot;
}

const started = Date.now();
console.log(`${botCount} bots hopping for ${minutes} min against ${apiUrl}`);
const bots = await Promise.all(
  Array.from({ length: botCount }, (_, i) => sleep(i * 150).then(() => hopper(i))),
);
const totals = bots.reduce(
  (t, b) => ({
    welcomes: t.welcomes + b.stats.welcomes,
    reconnects: t.reconnects + b.stats.reconnects,
    kicks: t.kicks + b.stats.kicks,
    errors: t.errors + b.stats.errors,
  }),
  { welcomes: 0, reconnects: 0, kicks: 0, errors: 0 },
);
console.log(
  JSON.stringify(
    {
      seconds: Math.round((Date.now() - started) / 1000),
      hops: summary.hops,
      ...totals,
      failedHops: summary.failures.length,
      failureSamples: summary.failures.slice(0, 5),
    },
    null,
    2,
  ),
);
process.exit(0);
