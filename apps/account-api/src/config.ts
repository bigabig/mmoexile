import { z } from "zod";
import { baseConfigSchema, loadConfig } from "@mmoexile/service-kit";
import { DEV_SESSION_SECRET } from "@mmoexile/auth";
import { LOCAL_REGIONS_SETTING, regionsSetting } from "@mmoexile/contracts";

export const configSchema = baseConfigSchema.extend({
  PORT: z.coerce.number().int().positive().default(3000),
  SESSION_SECRET: z.string().min(32).default(DEV_SESSION_SECRET),
  /** Issues every ticket, including the first one on /play. */
  ORCHESTRATOR_URL: z.string().default("http://localhost:3003"),
  /** The realm's regions (same setting as apps/directory); /play accepts only these. */
  REGIONS: regionsSetting(LOCAL_REGIONS_SETTING),
});

export type Config = z.infer<typeof configSchema>;

export function readConfig(env = process.env): Config {
  return loadConfig(configSchema, env);
}
