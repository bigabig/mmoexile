import { z } from "zod";
import { baseConfigSchema, loadConfig } from "@mmoexile/service-kit";
import { DEV_SESSION_SECRET, DEV_TICKET_SECRET } from "@mmoexile/auth";
import { DEV_SERVER_URLS, DEV_ZONE_PLACEMENT } from "@mmoexile/contracts";

export const configSchema = baseConfigSchema.extend({
  PORT: z.coerce.number().int().positive().default(3000),
  SESSION_SECRET: z.string().min(32).default(DEV_SESSION_SECRET),
  TICKET_SECRET: z.string().min(32).default(DEV_TICKET_SECRET),
  /** Client-facing instance server URLs: "a=ws://host:7001/ws,…". */
  SERVERS: z.string().default(DEV_SERVER_URLS),
  /** Which server hosts which zone: "nexus:a,…". */
  ZONE_PLACEMENT: z.string().default(DEV_ZONE_PLACEMENT),
});

export type Config = z.infer<typeof configSchema>;

export function readConfig(env = process.env): Config {
  return loadConfig(configSchema, env);
}
