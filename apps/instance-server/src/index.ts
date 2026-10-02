/** Composition root, for running instance servers in-process (tools/realm-tests). */
export { createInstanceServer, type InstanceServer, type InstanceServerDeps } from "./server.js";
export { readConfig, type Config } from "./config.js";
export { InMemoryPartyDirectory } from "./party/PartyDirectory.js";
