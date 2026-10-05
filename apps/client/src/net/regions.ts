import { createHttpClient, directoryApi, type RegionInfo } from "@mmoexile/contracts";

const directory = createHttpClient({ baseUrl: "/directory" });

/** The realm's regions, from the directory (proxied at /directory). */
export async function loadRegions(): Promise<RegionInfo[]> {
  const { realms } = await directory(directoryApi.listRealms, undefined);
  return realms[0]?.regions ?? [];
}
