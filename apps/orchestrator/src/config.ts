import { z } from "zod";
import { baseConfigSchema, loadConfig } from "@mmoexile/service-kit";
import { DEV_TICKET_PRIVATE_KEY } from "@mmoexile/auth";

export const configSchema = baseConfigSchema.extend({
  PORT: z.coerce.number().int().nonnegative().default(3003),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  /** CA for TLS to Redis (rediss://) with a private CA, e.g. in the cluster */
  REDIS_CA_FILE: z.string().optional(),
  /** How often instance servers report; three missed reports mean dead. */
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  /** Ed25519 private key for tickets (base64 PEM body). Only the orchestrator has it. */
  TICKET_PRIVATE_KEY: z.string().min(1).default(DEV_TICKET_PRIVATE_KEY),
});

export type Config = z.infer<typeof configSchema>;

export function readConfig(env = process.env): Config {
  return loadConfig(configSchema, env);
}
