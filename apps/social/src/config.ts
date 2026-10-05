import { z } from "zod";
import { baseConfigSchema, loadConfig } from "@mmoexile/service-kit";

export const configSchema = baseConfigSchema.extend({
  PORT: z.coerce.number().int().positive().default(3002),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  /** CA for TLS to Redis (rediss://) with a private CA, e.g. in the cluster */
  REDIS_CA_FILE: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

export function readConfig(env = process.env): Config {
  return loadConfig(configSchema, env);
}
