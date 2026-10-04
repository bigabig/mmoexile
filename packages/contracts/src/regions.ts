import { z } from "zod";

/**
 * A region of the realm (PoE's "gateway"), e.g. `eu` or `us`. Every
 * instance server runs in exactly one region; players choose theirs at
 * login. Lower-case letters, digits and dashes, so IDs are safe in URLs,
 * metric labels and environment variables.
 */
export const RegionId = z
  .string()
  .regex(/^[a-z0-9-]+$/, "Region IDs use lower-case letters, digits and dashes");
export type RegionId = z.infer<typeof RegionId>;

/** The region of single-machine setups (`pnpm dev`, tests). */
export const LOCAL_REGION = "local";
