import { createEntityIndex } from "bitecs";

/** bitECS does not export its EntityIndex type, so derive it. */
export type EntityIndex = ReturnType<typeof createEntityIndex>;

/**
 * The single entity-ID allocator for every GameWorld in this process.
 *
 * bitECS component data is stored in module-level arrays indexed by entity ID
 * (e.g. `Health.current[eid]` from @mmoexile/game-core), so all worlds in a
 * process share one storage. If each world allocated IDs on its own, two
 * worlds would both hand out `eid = 1` and overwrite each other's data.
 * Sharing one index keeps every ID unique across worlds.
 *
 * Its scope deliberately matches the component arrays: one per module
 * instance, i.e. one per process (or per worker thread).
 *
 * Caveat: bitECS checks entity liveness against this shared index, so
 * `removeEntity`/`entityExists` must only ever be called with entity IDs that
 * belong to the world passed in.
 */
export const processEntityIndex: EntityIndex = createEntityIndex();
