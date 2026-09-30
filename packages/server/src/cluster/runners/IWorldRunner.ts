import type { GameWorld } from "../../simulation/GameWorld.js";
import type { WorldTickResult } from "../../simulation/tick/TickBuffer.js";

export interface IWorldRunner {
  readonly world: GameWorld;
  start(): void;
  stop(): void;
  step(dt?: number, now?: number): WorldTickResult | void;
}
