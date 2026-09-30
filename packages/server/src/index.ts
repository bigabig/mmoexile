import http from "http";
import { WorldCluster } from "./cluster/index.js";
import { WebSocketGateway } from "./gateway/index.js";
import { persistenceService } from "./persistence/index.js";
import { disconnectDatabase } from "./persistence/connection.js";

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

// Layer 2: World Cluster
const cluster = new WorldCluster();

// Layer 1: WebSocket Gateway
const gateway = new WebSocketGateway(server, cluster);

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
  gateway.close();
  cluster.stop();
  persistenceService.stop();
  server.close(() => {
    console.log("[Server] Closed HTTP server.");
    process.exit(0);
  });

  // Force exit after 10s in case network/db hangs
  const forceExitTimer = setTimeout(() => {
    console.error("[Server] Graceful shutdown timed out, force exiting.");
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  try {
    // 1. Stop accepting new connections
    gateway.close();

    // 2. Halt simulation runners and snapshot all active player states
    cluster.prepareShutdown();

    // 3. Await final persistence flush to PostgreSQL
    await persistenceService.stop();

    // 4. Destroy world instances
    cluster.stop();

    // 5. Close HTTP server and database connection
    server.close(async () => {
      try {
        await disconnectDatabase();
      } catch (err) {
        console.error("[Server] Error disconnecting database:", err);
      }
      console.log("[Server] Closed HTTP server and DB connections cleanly.");
      process.exit(0);
    });
  } catch (err) {
    console.error("[Server] Error during graceful shutdown:", err);
    process.exit(1);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
