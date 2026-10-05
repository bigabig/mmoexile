export interface ShutdownSteps {
  gateway: { close(): unknown; disconnectAll(): void };
  host: { prepareShutdown(): void; stop(): void };
  /** Saves and releases every character (fenced), and kicks the sessions. */
  players: { shutdown(): Promise<void> };
  persistence: { stop(): Promise<unknown> };
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

  // 3. Final fenced save of every character, release its lease, kick it
  await steps.players.shutdown();

  // 4. Flush queued saves and wait for in-flight database writes
  await steps.persistence.stop();

  // 5. Destroy instances
  steps.host.stop();

  // 6. Disconnect remaining clients, then close the HTTP server
  steps.gateway.disconnectAll();
  await steps.closeHttpServer();

  // 7. Close the database (and other) connections
  await steps.disconnectDatabase();
}
