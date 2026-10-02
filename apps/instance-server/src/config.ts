import { z } from "zod";
import { baseConfigSchema, loadConfig } from "@mmoexile/service-kit";
import { DEV_TICKET_SECRET } from "@mmoexile/auth";
import { DEV_SERVER_URLS, DEV_ZONE_PLACEMENT } from "@mmoexile/contracts";

export const configSchema = baseConfigSchema.extend({
  PORT: z.coerce.number().int().nonnegative().default(3001),
  /** This server's id in SERVERS / ZONE_PLACEMENT. */
  SERVER_ID: z.string().min(1).default("a"),
  SERVERS: z.string().default(DEV_SERVER_URLS),
  ZONE_PLACEMENT: z.string().default(DEV_ZONE_PLACEMENT),
  TICKET_SECRET: z.string().min(32).default(DEV_TICKET_SECRET),
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
});

export type Config = z.infer<typeof configSchema>;

export function readConfig(env = process.env): Config {
  return loadConfig(configSchema, env);
}
