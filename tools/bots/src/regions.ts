import {
  createHttpClient,
  directoryApi,
  fastestRegion,
  measureRegions,
} from "@mmoexile/contracts";

/**
 * The region bots play in: `--region <id>` if given, otherwise the fastest
 * one, measured like the browser does (directory → ping every gateway).
 */
export async function resolveRegion(options: {
  requested?: string;
  directoryUrl: string;
  log?: (message: string) => void;
}): Promise<string> {
  if (options.requested) return options.requested;
  const call = createHttpClient({ baseUrl: options.directoryUrl });
  const { realms } = await call(directoryApi.listRealms, undefined);
  const measured = await measureRegions(realms[0]?.regions ?? []);
  options.log?.(
    `Region pings: ${measured.map((r) => `${r.id}=${r.pingMs ?? "unreachable"}${r.pingMs !== undefined ? " ms" : ""}`).join(", ")}`,
  );
  const fastest = fastestRegion(measured);
  if (!fastest) throw new Error(`No reachable region in the directory at ${options.directoryUrl}`);
  return fastest;
}

/** The directory next to an account-api URL behind the client's proxy (…/api → …/directory). */
export const directoryNextTo = (apiUrl: string) => apiUrl.replace(/\/api\/?$/, "/directory");
