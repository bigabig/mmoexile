import http from "http";
import { InstanceHost } from "./cluster/index.js";
import { WebSocketGateway } from "./gateway/index.js";
import { persistenceService } from "./persistence/index.js";
import { disconnectDatabase } from "@mmoexile/db";
import { gracefulShutdown } from "./shutdown.js";

const PORT = Number(process.env.PORT) || 3001;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("RotMG Voxel MMO Server Running");
});

// Layer 2: Instance Host
const host = new InstanceHost();

// Layer 1: WebSocket Gateway
const gateway = new WebSocketGateway(server, host);

server.listen(PORT, () => {
  console.log(
    `[Server] RotMG Voxel MMO server listening on http://localhost:${PORT}`,
  );
  console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/ws`);
});

let isShuttingDown = false;
const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("[Server] Shutting down gracefully...");

  // Force exit after 10s in case network/db hangs
  const forceExitTimer = setTimeout(() => {
    console.error("[Server] Graceful shutdown timed out, force exiting.");
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  try {
    await gracefulShutdown({
      gateway,
      host,
      persistence: persistenceService,
      closeHttpServer: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
      disconnectDatabase,
    });
    console.log("[Server] Saved all players and shut down cleanly.");
    process.exit(0);
  } catch (err) {
    console.error("[Server] Error during graceful shutdown:", err);
    process.exit(1);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
