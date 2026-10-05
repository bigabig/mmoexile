import { Bot, sleep } from "./bot.js";

export interface SwarmOptions {
  /** account-api base URL, e.g. http://localhost:8080/api */
  apiUrl: string;
  /** Region every bot plays in (see resolveRegion). */
  region?: string;
  bots: number;
  /** Zones to travel through in a loop, e.g. ["nexus", "overworld"]. */
  route: string[];
  /** Delay between bot starts, so logins don't all arrive at once. */
  staggerMs?: number;
}

export interface SwarmReport {
  seconds: number;
  hops: number;
  /** Killed by monsters on the way (permadeath; a new character continues). */
  deaths: number;
  welcomes: number;
  reconnects: number;
  kicks: number;
  errors: number;
  disconnects: number;
  welcomesPerServer: Record<string, number>;
  failedHops: number;
  /** The bots' own event loop lag: high values mean the load generator was the bottleneck. */
  botEventLoopLagMs: { p95: number; max: number };
  failureSamples: string[];
}

/**
 * A group of bots that travel a route of zones until stopped. Dead, kicked or
 * disconnected bots log in again (with a new character if needed).
 */
export class Swarm {
  readonly bots: Bot[] = [];
  private running = true;
  private done: Promise<unknown> | undefined;
  private readonly startedAt = Date.now();
  private readonly runId = Math.floor(Math.random() * 1e4);
  private readonly failures: string[] = [];
  private deaths = 0;
  private readonly lagSamples: number[] = [];
  private lagTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: SwarmOptions) {}

  start(): void {
    let lastTick = performance.now();
    this.lagTimer = setInterval(() => {
      const now = performance.now();
      this.lagSamples.push(now - lastTick - 500);
      lastTick = now;
    }, 500);
    const stagger = this.options.staggerMs ?? 150;
    this.done = Promise.all(
      Array.from({ length: this.options.bots }, (_, i) =>
        sleep(i * stagger).then(() => (this.running ? this.hopper(i) : undefined)),
      ),
    );
  }

  /** Bots currently connected and in a zone. */
  online(): number {
    return this.bots.filter((b) => b.online).length;
  }

  /** Counters summed over all bots, at this moment. */
  totals() {
    return this.bots.reduce(
      (t, b) => ({
        welcomes: t.welcomes + b.stats.welcomes,
        reconnects: t.reconnects + b.stats.reconnects,
        kicks: t.kicks + b.stats.kicks,
        errors: t.errors + b.stats.errors,
        disconnects: t.disconnects + b.stats.disconnects,
        refusals: t.refusals + b.stats.refusals,
        hops: t.hops + b.stats.hops,
      }),
      { welcomes: 0, reconnects: 0, kicks: 0, errors: 0, disconnects: 0, refusals: 0, hops: 0 },
    );
  }

  /** Lets every bot finish its current hop, disconnects them, and reports. */
  async stop(): Promise<SwarmReport> {
    this.running = false;
    await this.done;
    clearInterval(this.lagTimer);
    const lag = [...this.lagSamples].sort((a, b) => a - b);
    const welcomesPerServer: Record<string, number> = {};
    for (const bot of this.bots) {
      for (const [url, count] of bot.servers) {
        welcomesPerServer[url] = (welcomesPerServer[url] ?? 0) + count;
      }
    }
    return {
      seconds: Math.round((Date.now() - this.startedAt) / 1000),
      deaths: this.deaths,
      ...this.totals(),
      welcomesPerServer,
      failedHops: this.failures.length,
      botEventLoopLagMs: {
        p95: Math.round(lag[Math.floor(lag.length * 0.95)] ?? 0),
        max: Math.round(lag.at(-1) ?? 0),
      },
      failureSamples: this.failures.slice(0, 5),
    };
  }

  private async hopper(index: number): Promise<void> {
    const bot = new Bot({
      apiUrl: this.options.apiUrl,
      region: this.options.region,
      name: `Hop${this.runId}x${index}`,
    });
    this.bots.push(bot);
    try {
      await bot.signIn();
    } catch (err) {
      this.failures.push(`${bot.name} sign-in failed: ${(err as Error).message}`);
      return;
    }
    await this.rejoin(bot);
    const route = this.options.route;
    while (this.running) {
      const here = route.indexOf(bot.zoneId);
      const target = route[(here + 1) % route.length];
      try {
        await bot.travelTo(target);
        bot.stats.hops++;
      } catch (err) {
        if (bot.hp <= 0) this.deaths++;
        else this.failures.push((err as Error).message);
        if (bot.hp <= 0 || bot.kicked || bot.disconnected) {
          // Permadeath, kick or lost server: get a (new) character and start over
          await this.rejoin(bot);
        }
      }
      await sleep(250);
    }
    bot.disconnect();
  }

  /** Logs in again until it works (or the swarm is stopped). */
  private async rejoin(bot: Bot): Promise<void> {
    while (this.running) {
      try {
        await bot.ensureCharacter();
        await bot.play();
        if (!bot.kicked && !bot.disconnected) return;
        this.failures.push(
          `${bot.name} rejoin ${bot.kicked ? `kicked: ${bot.kicked}` : "disconnected"}`,
        );
      } catch (err) {
        this.failures.push(`${bot.name} rejoin failed: ${(err as Error).message}`);
      }
      await sleep(1000);
    }
  }
}
