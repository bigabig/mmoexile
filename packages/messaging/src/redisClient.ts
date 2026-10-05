import { readFileSync } from "node:fs";
import { Redis, type RedisOptions } from "ioredis";

export interface RedisClientConfig {
  /** redis://… or, for TLS, rediss://user:password@host:port */
  url: string;
  /**
   * CA certificate (PEM file) the server's certificate must be signed by,
   * for TLS (rediss://) with a private CA, as in the cluster (REDIS_CA_FILE).
   * Unset: plain connections, or TLS verified against the system's CAs.
   */
  caFile?: string;
}

/** The client options for a configuration (exported for tests). */
export function redisOptions(
  config: Pick<RedisClientConfig, "caFile">,
  readFile: (path: string) => Buffer = readFileSync,
): RedisOptions {
  // ioredis verifies the certificate and the host name against these CAs
  return config.caFile ? { tls: { ca: readFile(config.caFile) } } : {};
}

/** A Redis client for a service. Its duplicates (subscribers) share the options. */
export function createRedis(config: RedisClientConfig, extra: RedisOptions = {}): Redis {
  return new Redis(config.url, { ...redisOptions(config), ...extra });
}
