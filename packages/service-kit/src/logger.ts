import { pino, type Logger, type LevelWithSilent } from "pino";

export type { Logger };

/**
 * Structured JSON logger. Every line carries the service name, so logs from
 * several services can be merged and filtered.
 */
export function createLogger(
  service: string,
  level: LevelWithSilent = "info",
): Logger {
  return pino({ name: service, level, base: { service } });
}
