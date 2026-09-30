import type { GameWorld } from "../../simulation/GameWorld.js";
import type { IWorldRunner } from "./IWorldRunner.js";
import type { WorldTickResult } from "../../simulation/tick/TickBuffer.js";

export type WorldTickCallback = (result: WorldTickResult) => void;

export class InProcessWorldRunner implements IWorldRunner {
  public readonly world: GameWorld;
  private tickIntervalMs: number;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private onTick?: WorldTickCallback;

  constructor(
    world: GameWorld,
    tickRateHz: number = 30,
    onTick?: WorldTickCallback,
  ) {
    this.world = world;
    this.tickIntervalMs = 1000 / tickRateHz;
    this.onTick = onTick;
  }

  public setOnTick(callback: WorldTickCallback): void {
    this.onTick = callback;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.intervalTimer = setInterval(() => {
      const result = this.step(1 / 30, Date.now());
      if (this.onTick) {
        this.onTick(result);
      }
    }, this.tickIntervalMs);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  public step(dt: number = 1 / 30, now: number = Date.now()): WorldTickResult {
    return this.world.tick(dt, now);
  }
}
