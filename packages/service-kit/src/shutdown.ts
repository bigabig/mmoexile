import type { Logger } from "./logger.js";

export interface ShutdownOptions {
  logger: Logger;
  /** Runs once on SIGINT/SIGTERM; must stop the service cleanly. */
  shutdown: () => Promise<void>;
  /** Force-exit if shutdown hangs. */
  timeoutMs?: number;
  /**
   * Optional graceful phase before shutdown, run on SIGTERM only (what
   * Docker and Kubernetes send). SIGINT (Ctrl-C) or a second signal skips it.
   */
  drain?: {
    run: () => Promise<void>;
    /** Shut down anyway after this long. */
    timeoutMs: number;
  };
  exit?: (code: number) => void;
}

/**
 * Installs SIGINT/SIGTERM handlers that run `shutdown` exactly once, then
 * exit with 0 (or 1 on error or timeout). Returns the trigger, e.g. for
 * tests: `trigger("SIGTERM")` drains first if a drain is configured.
 */
export function handleShutdownSignals(
  options: ShutdownOptions,
): (signal?: NodeJS.Signals) => Promise<void> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let started = false;
  let draining: Promise<void> | undefined;

  const shutdownNow = async () => {
    if (started) return;
    started = true;
    options.logger.info("Shutting down");

    const timer = setTimeout(() => {
      options.logger.error("Shutdown timed out, forcing exit");
      exit(1);
    }, options.timeoutMs ?? 10_000);
    timer.unref();

    try {
      await options.shutdown();
      clearTimeout(timer);
      options.logger.info("Shut down cleanly");
      exit(0);
    } catch (err) {
      clearTimeout(timer);
      options.logger.error({ err }, "Error during shutdown");
      exit(1);
    }
  };

  const drainThenShutdown = async (drain: NonNullable<ShutdownOptions["drain"]>) => {
    options.logger.info({ timeoutMs: drain.timeoutMs }, "Draining before shutdown (signal again to skip)");
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        options.logger.warn("Drain timed out");
        resolve();
      }, drain.timeoutMs);
      timer.unref();
    });
    try {
      await Promise.race([drain.run(), timedOut]);
    } catch (err) {
      options.logger.error({ err }, "Drain failed");
    } finally {
      clearTimeout(timer);
    }
    await shutdownNow();
  };

  const trigger = async (signal?: NodeJS.Signals) => {
    if (signal === "SIGTERM" && options.drain && !draining && !started) {
      draining = drainThenShutdown(options.drain);
      return draining;
    }
    // SIGINT, no drain configured, or impatient second signal
    await shutdownNow();
  };

  process.on("SIGINT", () => void trigger("SIGINT"));
  process.on("SIGTERM", () => void trigger("SIGTERM"));
  return trigger;
}

/**
 * Logs promise rejections nobody handled instead of crashing (Node's
 * default). A forgotten `.catch` on a background call, e.g. a presence
 * update while Redis restarts, must not take down a server with all its
 * players. Every such log line is a bug to fix at its source.
 */
export function logUnhandledRejections(logger: Logger): void {
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });
}
