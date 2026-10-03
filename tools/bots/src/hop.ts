/**
 * Load and soak test: N bots travel a route of zones for a while and report
 * handoffs, kicks, errors and where they were placed. Dead characters are
 * replaced. See TESTS.md.
 *
 *   pnpm --filter @mmoexile/bots hop -- --bots 20 --minutes 2 --api http://localhost:8080/api
 *
 * --route nexus,overworld (default) hops between the hubs; with
 * --route nexus,overworld,golem_dungeon every bot also opens its own dungeon
 * instance, which shows how the orchestrator spreads new instances.
 */
import { sleep } from "./bot.js";
import { Swarm } from "./swarm.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const apiUrl = arg("api", "http://localhost:8080/api");
const bots = Number(arg("bots", "10"));
const minutes = Number(arg("minutes", "1"));
const route = arg("route", "nexus,overworld").split(",");

console.log(`${bots} bots travelling ${route.join(" → ")} for ${minutes} min against ${apiUrl}`);
const swarm = new Swarm({ apiUrl, bots, route });
swarm.start();
await sleep(minutes * 60_000);
console.log(JSON.stringify(await swarm.stop(), null, 2));
process.exit(0);
