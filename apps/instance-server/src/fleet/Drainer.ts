import type { InstanceHost } from "../cluster/index.js";
import type { PlayerLifecycle } from "../players/PlayerLifecycle.js";
import type { FleetAgent } from "./FleetAgent.js";

export interface DrainerDeps {
  host: InstanceHost;
  lifecycle: PlayerLifecycle;
  fleet?: FleetAgent;
  /** Private instances may finish for this long, then everyone is moved. */
  timeoutMs: number;
  /** How often remaining players are re-checked. */
  checkIntervalMs?: number;
  now?: () => number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

/**
 * Empties this server so it can stop without disrupting anyone:
 * 1. Report `draining`: the orchestrator sends no new players here.
 * 2. Hub (public) players move to other shards of their zone right away.
 * 3. Private instances (dungeons) may finish until the drain timeout, then
 *    their players are moved to a nexus on another server.
 * 4. Done when no players are left (or moving them keeps failing).
 */
export class Drainer {
  private running: Promise<void> | undefined;
  private readonly now: () => number;
  private readonly log: NonNullable<DrainerDeps["log"]>;

  constructor(private readonly deps: DrainerDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
  }

  get active(): boolean {
    return this.running !== undefined;
  }

  /** Starts draining (once); resolves when the server is empty. */
  drain(): Promise<void> {
    this.running ??= this.run();
    return this.running;
  }

  private async run(): Promise<void> {
    const { host, lifecycle } = this.deps;
    await this.deps.fleet?.setState("draining");
    const deadline = this.now() + this.deps.timeoutMs;
    this.log("Draining", { players: lifecycle.all().length, timeoutMs: this.deps.timeoutMs });

    const everyone = lifecycle.all().map((p) => p.characterId);
    if (everyone.length > 0) {
      host.messageBus.publishChat({
        sender: "System",
        text: `This server is restarting. Hubs move you right away; dungeons close in ${Math.ceil(this.deps.timeoutMs / 60_000)} min.`,
        kind: "system",
        targetPlayerIds: everyone,
      });
    }

    let lastCount = -1;
    while (lifecycle.all().length > 0) {
      const expired = this.now() >= deadline;
      await Promise.all(
        lifecycle.all().map((player) => {
          const zone = host.getInstanceForPlayer(player.characterId)?.zone;
          if (!zone) return false;
          if (zone.access.kind === "public_sharded") {
            return lifecycle.handOff(player.characterId, zone.id, undefined, {
              excludeThisServer: true,
              notifyOnFailure: false,
            });
          }
          if (!expired) return false;
          return lifecycle.handOff(player.characterId, "nexus", undefined, {
            excludeThisServer: true,
            notifyOnFailure: false,
          });
        }),
      );

      const remaining = lifecycle.all().length;
      if (remaining !== lastCount) {
        this.log("Drain progress", { remaining });
        lastCount = remaining;
      }
      if (remaining === 0) break;
      if (expired && this.now() >= deadline + 10_000) {
        // Nowhere to move them: shutdown saves and disconnects them.
        this.log("Drain gave up moving players", { remaining });
        break;
      }
      await new Promise((r) => setTimeout(r, this.deps.checkIntervalMs ?? 1000));
    }
    this.log("Drained");
  }
}
