import type { Logger } from "./logger.js";

export interface ShutdownOptions {
  logger: Logger;
  /** Runs once on SIGINT/SIGTERM; must stop the service cleanly. */
  shutdown: () => Promise<void>;
  /** Force-exit if shutdown hangs. */
  timeoutMs?: number;
  exit?: (code: number) => void;
}

/**
 * Installs SIGINT/SIGTERM handlers that run `shutdown` exactly once, then
 * exit with 0 (or 1 on error or timeout). Returns the trigger, e.g. for tests.
 */
export function handleShutdownSignals(
  options: ShutdownOptions,
): () => Promise<void> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let started = false;

  const trigger = async () => {
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

  process.once("SIGINT", trigger);
  process.once("SIGTERM", trigger);
  return trigger;
}
