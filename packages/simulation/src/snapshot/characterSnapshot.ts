import { hasComponent } from "bitecs";
import {
  Equipment,
  Health,
  Identity,
  Inventory,
  Player,
  Position,
  Progression,
} from "@mmoexile/game-core";
import type { GameWorld } from "../GameWorld.js";
import type { SpawnPlayerOptions } from "../ecs/EntityFactory.js";
import type { PlayerPersistenceSnapshot } from "../events/WorldEvents.js";

/**
 * Everything that defines a character's state inside an instance. The single
 * source for transfers between instances, periodic saves, and (Stage 2)
 * handoffs between servers.
 *
 * MP is not simulated yet (there is no mana component), so it is not part of
 * the snapshot; persisted MP is left untouched.
 */
export interface CharacterSnapshot {
  id: string;
  name: string;
  classId: string;
  level: number;
  xp: number;
  hp: number;
  x: number;
  y: number;
  zoneId: string;
  isAlive: boolean;
  equipment: { weapon: string | null; armor: string | null };
  inventory: (string | null)[];
}

export function snapshotCharacter(
  world: GameWorld,
  characterId: string,
): CharacterSnapshot | null {
  const eid = world.uuidToEid.get(characterId);
  if (eid === undefined || !hasComponent(world.ecsWorld, eid, Player)) {
    return null;
  }
  return {
    id: characterId,
    name: Identity.name[eid],
    classId: Progression.classId[eid],
    level: Progression.level[eid],
    xp: Progression.xp[eid],
    hp: Health.current[eid],
    x: Position.x[eid],
    y: Position.y[eid],
    zoneId: world.zoneId,
    isAlive: Health.current[eid] > 0,
    equipment: {
      weapon: Equipment.weapon[eid] ?? null,
      armor: Equipment.armor[eid] ?? null,
    },
    inventory: [...(Inventory.slots[eid] || new Array(8).fill(null))],
  };
}

/** Spawn options to recreate a snapshotted character at a new position. */
export function spawnOptionsFromSnapshot(
  snapshot: CharacterSnapshot,
  at: { x: number; y: number },
): SpawnPlayerOptions {
  return {
    id: snapshot.id,
    name: snapshot.name,
    classId: snapshot.classId,
    level: snapshot.level,
    xp: snapshot.xp,
    hp: snapshot.hp,
    x: at.x,
    y: at.y,
    equipment: { ...snapshot.equipment },
    inventory: [...snapshot.inventory],
  };
}

/** The subset of a snapshot that is written to the database. */
export function persistenceFromSnapshot(
  snapshot: CharacterSnapshot,
): PlayerPersistenceSnapshot {
  return {
    hp: snapshot.hp,
    level: snapshot.level,
    xp: snapshot.xp,
    x: snapshot.x,
    y: snapshot.y,
    currentWorld: snapshot.zoneId,
    isAlive: snapshot.isAlive,
    equippedWeapon: snapshot.equipment.weapon,
    equippedArmor: snapshot.equipment.armor,
    inventory: JSON.stringify(snapshot.inventory),
  };
}
