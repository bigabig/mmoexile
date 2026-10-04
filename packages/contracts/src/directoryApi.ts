import { z } from "zod";
import { RegionId } from "./regions.js";

/**
 * HTTP API of apps/directory: the global entry point that lists realms and
 * their regions. Public and cacheable; the game client calls it before
 * login to pick a region by ping.
 */

export const RegionInfo = z.object({
  id: RegionId,
  /** Display name, e.g. "Europe". */
  name: z.string().min(1),
  /**
   * The region's gateway ping endpoint (204, CORS-enabled). Its round trip
   * is the player's latency to that region's game servers.
   */
  pingUrl: z.string().min(1),
});
export type RegionInfo = z.infer<typeof RegionInfo>;

export const RealmInfo = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Base URL of the realm's account-api (may be relative to the directory's origin). */
  accountApiUrl: z.string().min(1),
  regions: z.array(RegionInfo).min(1),
});
export type RealmInfo = z.infer<typeof RealmInfo>;

export const directoryApi = {
  listRealms: {
    method: "GET",
    path: "/realms",
    body: z.undefined(),
    response: z.object({ realms: z.array(RealmInfo) }),
  },
} as const;

/**
 * Parses the `REGIONS` setting shared by apps/directory and account-api:
 * comma-separated `id=Name=pingUrl` entries, e.g.
 * `eu=Europe=http://localhost:7100/ping,us=North America=http://localhost:7200/ping`.
 * Throws on malformed entries and duplicate IDs.
 */
export function parseRegions(value: string): RegionInfo[] {
  const regions = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [id, name, ...url] = entry.split("=");
      const parsed = RegionInfo.safeParse({ id: id?.trim(), name: name?.trim(), pingUrl: url.join("=").trim() });
      if (!parsed.success) {
        throw new Error(`Invalid region "${entry}": expected id=Name=pingUrl with a lower-case id`);
      }
      return parsed.data;
    });
  if (regions.length === 0) throw new Error("REGIONS must list at least one region");
  const ids = regions.map((r) => r.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new Error(`Region "${duplicate}" is listed twice`);
  return regions;
}
