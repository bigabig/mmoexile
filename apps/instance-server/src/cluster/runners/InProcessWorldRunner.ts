import type { GameWorld } from "@mmoexile/simulation";
import type { IWorldRunner } from "./IWorldRunner.js";
import type { WorldTickResult } from "@mmoexile/simulation";

export type WorldTickCallback = (result: WorldTickResult) => void;
export type WorldErrorCallback = (error: unknown) => void;
/**
 * Called after every tick with its duration and the time since the previous
 * tick started (undefined for the first tick after a start). The interval
 * shows whether the process keeps up: it grows when the event loop is busy,
 * even if every single tick is fast.
 */
export type WorldTimingCallback = (durationMs: number, intervalMs?: number) => void;

export class InProcessWorldRunner implements IWorldRunner {
  public readonly world: GameWorld;
  private tickIntervalMs: number;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastTickStart: number | undefined;
  private onTick?: WorldTickCallback;
  private onError?: WorldErrorCallback;
  private onTiming?: WorldTimingCallback;

  constructor(
    world: GameWorld,
    tickRateHz: number = 30,
    onTick?: WorldTickCallback,
    onError?: WorldErrorCallback,
    onTiming?: WorldTimingCallback,
  ) {
    this.world = world;
    this.tickIntervalMs = 1000 / tickRateHz;
    this.onTick = onTick;
    this.onError = onError;
    this.onTiming = onTiming;
  }

  public setOnTick(callback: WorldTickCallback): void {
    this.onTick = callback;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTickStart = undefined;

    this.intervalTimer = setInterval(() => {
      // Error boundary: a failing tick stops this world only, never the process.
      try {
        const started = performance.now();
        const interval =
          this.lastTickStart === undefined ? undefined : started - this.lastTickStart;
        this.lastTickStart = started;
        const result = this.step(1 / 30, Date.now());
        this.onTiming?.(performance.now() - started, interval);
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
