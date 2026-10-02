import { z } from "zod";
import { baseConfigSchema, loadConfig } from "@mmoexile/service-kit";
import { DEV_TICKET_PUBLIC_KEY } from "@mmoexile/auth";

export const configSchema = baseConfigSchema.extend({
  PORT: z.coerce.number().int().nonnegative().default(3001),
  /** Unique within the fleet; any server can host any zone. */
  SERVER_ID: z.string().min(1).default("a"),
  /** Ed25519 public key tickets are verified with (base64 PEM body). */
  TICKET_PUBLIC_KEY: z.string().min(1).default(DEV_TICKET_PUBLIC_KEY),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  /** apps/social, for party commands. */
  SOCIAL_URL: z.string().default("http://localhost:3002"),
  LEASE_TTL_MS: z.coerce.number().int().positive().default(30_000),
  /** Client-facing WebSocket URL; defaults to ws://localhost:<port>/ws. */
  PUBLIC_URL: z.string().optional(),
  /** Internal HTTP API (orchestrator calls, metrics); never exposed to clients. */
  INTERNAL_PORT: z.coerce.number().int().nonnegative().default(9001),
  /** How the orchestrator reaches INTERNAL_PORT; defaults to localhost. */
  INTERNAL_URL: z.string().optional(),
  /** Empty disables fleet registration (tests, standalone runs). */
  ORCHESTRATOR_URL: z.string().default("http://localhost:3003"),
  REGION: z.string().default("local"),
  /** Players this server should hold at most (placement limit). */
  CAPACITY: z.coerce.number().int().positive().default(200),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  /** Draining: how long private instances may finish before players are moved. */
  DRAIN_TIMEOUT_SEC: z.coerce.number().nonnegative().default(600),
});

export type Config = z.infer<typeof configSchema>;

export function readConfig(env = process.env): Config {
  return loadConfig(configSchema, env);
}
