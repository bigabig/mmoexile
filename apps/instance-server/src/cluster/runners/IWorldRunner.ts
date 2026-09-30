import type { GameWorld } from "@mmoexile/simulation";
import type { WorldTickResult } from "@mmoexile/simulation";

export interface IWorldRunner {
  readonly world: GameWorld;
  start(): void;
  stop(): void;
  step(dt?: number, now?: number): WorldTickResult | void;
}
