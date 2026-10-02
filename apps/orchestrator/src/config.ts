import { z } from "zod";
import { baseConfigSchema, loadConfig } from "@mmoexile/service-kit";
import { DEV_TICKET_SECRET } from "@mmoexile/auth";

export const configSchema = baseConfigSchema.extend({
  PORT: z.coerce.number().int().nonnegative().default(3003),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  /** How often instance servers report; three missed reports mean dead. */
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  TICKET_SECRET: z.string().min(32).default(DEV_TICKET_SECRET),
});

export type Config = z.infer<typeof configSchema>;

export function readConfig(env = process.env): Config {
  return loadConfig(configSchema, env);
}
