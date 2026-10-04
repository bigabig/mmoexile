import { z } from "zod";
import { LOCAL_REGIONS_SETTING, regionsSetting } from "@mmoexile/contracts";
import { baseConfigSchema, loadConfig } from "@mmoexile/service-kit";

export const configSchema = baseConfigSchema.extend({
  PORT: z.coerce.number().int().nonnegative().default(3004),
  REALM_ID: z.string().min(1).default("standard"),
  REALM_NAME: z.string().min(1).default("Standard"),
  /** The realm's account-api as the browser reaches it (relative: same origin). */
  ACCOUNT_API_URL: z.string().min(1).default("/api"),
  /**
   * `id=Name=pingUrl,…` (see parseRegions). The default is one local region
   * that pings this service itself, so `pnpm dev` needs no gateways.
   */
  REGIONS: regionsSetting(LOCAL_REGIONS_SETTING),
  /** How long browsers and proxies may cache the realm list. */
  CACHE_MAX_AGE_SEC: z.coerce.number().int().nonnegative().default(60),
});

export type Config = z.infer<typeof configSchema>;

export function readConfig(env = process.env): Config {
  return loadConfig(configSchema, env);
}
