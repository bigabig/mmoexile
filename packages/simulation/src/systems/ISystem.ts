import type { GameWorld } from "../GameWorld.js";

export interface ISystem {
  readonly name: string;
  init?(world: GameWorld): void;
  update(world: GameWorld, dt: number, now: number): void;
  destroy?(): void;
}
