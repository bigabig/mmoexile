import type { IncomingMessage, ServerResponse } from "http";
import type { InstanceHost } from "./cluster/index.js";

export interface HttpHandlerOptions {
  /** Expose /debug/* endpoints (development only). */
  debugEndpoints: boolean;
  now?: () => number;
}

/** HTTP routes served next to the WebSocket endpoint. */
export function createHttpHandler(
  host: InstanceHost,
  options: HttpHandlerOptions,
) {
  const now = options.now ?? Date.now;

  return (req: IncomingMessage, res: ServerResponse): void => {
    const path = (req.url ?? "/").split("?")[0];

    if (path === "/health") {
      const instances = host.getAllInstances();
      return sendJson(res, 200, {
        status: "ok",
        uptime: process.uptime(),
        instances: instances.length,
        players: instances.reduce((sum, i) => sum + i.players.size, 0),
      });
    }

    if (options.debugEndpoints && path === "/debug/instances") {
      const at = now();
      return sendJson(
        res,
        200,
        host.getAllInstances().map((i) => ({
          id: i.id,
          zone: i.zone.id,
          state: i.state,
          players: i.players.size,
          ownerPartyId: i.ownerPartyId ?? null,
          ageSec: Math.round((at - i.createdAt) / 1000),
          emptyForSec:
            i.emptySince === undefined
              ? null
              : Math.round((at - i.emptySince) / 1000),
          tick: i.world.currentTick,
        })),
      );
    }

    if (path === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("mmoexile instance server");
      return;
    }

    sendJson(res, 404, { error: "not found" });
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
