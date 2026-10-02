export interface ShutdownSteps {
  gateway: { close(): unknown; disconnectAll(): void };
  host: { prepareShutdown(): void; stop(): void };
  persistence: { stop(): Promise<void> };
  closeHttpServer(): Promise<void>;
  disconnectDatabase(): Promise<void>;
}

/**
 * Shuts the server down without losing character data. The order matters:
 * players must be snapshotted (2) and flushed (3) before the instances that
 * hold their state are destroyed (4).
 */
export async function gracefulShutdown(steps: ShutdownSteps): Promise<void> {
  // 1. Stop accepting new connections
  steps.gateway.close();

  // 2. Freeze all instances and queue final snapshots of every player
  steps.host.prepareShutdown();

  // 3. Flush queued saves and wait for in-flight database writes
  await steps.persistence.stop();

  // 4. Destroy instances
  steps.host.stop();

  // 5. Disconnect clients, then close the HTTP server
  steps.gateway.disconnectAll();
  await steps.closeHttpServer();

  // 6. Close the database connection
  await steps.disconnectDatabase();
}
