/**
 * Load and soak test: N bots travel a route of zones for a while and report
 * handoffs, kicks, errors and where they were placed. Dead characters are
 * replaced. See TESTS.md.
 *
 *   pnpm --filter @mmoexile/bots hop -- --bots 20 --minutes 2 --api http://localhost:8080/api
 *
 * --region eu plays in one region; by default the bots measure every
 * region's ping (via the directory next to --api, or --directory) and take
 * the fastest, like the browser.
 *
 * --route nexus,overworld (default) hops between the hubs; with
 * --route nexus,overworld,golem_dungeon every bot also opens its own dungeon
 * instance, which shows how the orchestrator spreads new instances.
 */
import { sleep } from "./bot.js";
import { directoryNextTo, resolveRegion } from "./regions.js";
import { Swarm } from "./swarm.js";

function arg(name: string, fallback: string): string;
function arg(name: string): string | undefined;
function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const apiUrl = arg("api", "http://localhost:8080/api");
const bots = Number(arg("bots", "10"));
const minutes = Number(arg("minutes", "1"));
const route = arg("route", "nexus,overworld").split(",");

const region = await resolveRegion({
  requested: arg("region"),
  directoryUrl: arg("directory", directoryNextTo(apiUrl)),
  log: console.log,
});

console.log(`${bots} bots travelling ${route.join(" → ")} in region ${region} for ${minutes} min against ${apiUrl}`);
const swarm = new Swarm({ apiUrl, region, bots, route });
swarm.start();
await sleep(minutes * 60_000);
console.log(JSON.stringify(await swarm.stop(), null, 2));
process.exit(0);
