/**
 * Static placement for Stage 2: a fixed table says which instance server
 * hosts which zone ("zone servers"). Replaced by the orchestrator in Stage 3.
 */

export type ServerId = string;

/** Development default: one instance server on :3001 hosts every zone. */
export const DEV_SERVER_URLS = "a=ws://localhost:3001/ws";
export const DEV_ZONE_PLACEMENT = "nexus:a,overworld:a,golem_dungeon:a";

/** Parses "a=ws://localhost:7001/ws,b=ws://localhost:7002/ws". */
export function parseServerUrls(value: string): Map<ServerId, string> {
  const servers = new Map<ServerId, string>();
  for (const entry of splitList(value)) {
    const [id, url] = splitPair(entry, "=");
    servers.set(id, url);
  }
  return servers;
}

/** Parses "nexus:a,overworld:b,golem_dungeon:b". */
export function parseZonePlacement(value: string): Map<string, ServerId> {
  const placement = new Map<string, ServerId>();
  for (const entry of splitList(value)) {
    const [zoneId, serverId] = splitPair(entry, ":");
    placement.set(zoneId, serverId);
  }
  return placement;
}

export interface StaticPlacement {
  servers: Map<ServerId, string>;
  zones: Map<string, ServerId>;
}

export function parseStaticPlacement(
  serverUrls: string,
  zonePlacement: string,
): StaticPlacement {
  const servers = parseServerUrls(serverUrls);
  const zones = parseZonePlacement(zonePlacement);
  for (const [zoneId, serverId] of zones) {
    if (!servers.has(serverId)) {
      throw new Error(
        `Zone ${zoneId} is placed on unknown server "${serverId}"`,
      );
    }
  }
  return { servers, zones };
}

/** The server that hosts a zone, and its client-facing URL. */
export function serverForZone(
  placement: StaticPlacement,
  zoneId: string,
): { serverId: ServerId; url: string } {
  const serverId = placement.zones.get(zoneId);
  if (!serverId) throw new Error(`No server hosts zone ${zoneId}`);
  return { serverId, url: placement.servers.get(serverId)! };
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitPair(entry: string, separator: string): [string, string] {
  const index = entry.indexOf(separator);
  if (index <= 0 || index === entry.length - 1) {
    throw new Error(`Invalid entry "${entry}" (expected key${separator}value)`);
  }
  return [entry.slice(0, index).trim(), entry.slice(index + 1).trim()];
}
