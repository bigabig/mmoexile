import type { GameWorld } from "@mmoexile/simulation";
import type { IWorldRunner } from "./IWorldRunner.js";
import type { WorldTickResult } from "@mmoexile/simulation";

export type WorldTickCallback = (result: WorldTickResult) => void;
export type WorldErrorCallback = (error: unknown) => void;

export class InProcessWorldRunner implements IWorldRunner {
  public readonly world: GameWorld;
  private tickIntervalMs: number;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private onTick?: WorldTickCallback;
  private onError?: WorldErrorCallback;

  constructor(
    world: GameWorld,
    tickRateHz: number = 30,
    onTick?: WorldTickCallback,
    onError?: WorldErrorCallback,
  ) {
    this.world = world;
    this.tickIntervalMs = 1000 / tickRateHz;
    this.onTick = onTick;
    this.onError = onError;
  }

  public setOnTick(callback: WorldTickCallback): void {
    this.onTick = callback;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.intervalTimer = setInterval(() => {
      // Error boundary: a failing tick stops this world only, never the process.
      try {
        const result = this.step(1 / 30, Date.now());
        if (this.onTick) {
          this.onTick(result);
        }
      } catch (error) {
        this.stop();
        if (this.onError) {
          this.onError(error);
        } else {
          throw error;
        }
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
