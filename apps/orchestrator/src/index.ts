/** Composition root, for running the orchestrator in-process (tools/realm-tests). */
export { createOrchestrator, type Orchestrator, type OrchestratorDeps } from "./app.js";
export { readConfig, type Config } from "./config.js";
export { Registry } from "./Registry.js";
export { DEFAULT_WEIGHTS, type PlacementWeights } from "./placement.js";
