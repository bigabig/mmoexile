import { hasComponent } from "bitecs";
import {
  Inventory,
  Equipment,
  Progression,
  CombatStats,
  Health,
  Speed,
  canEquipItem,
  computeBaseStatsForLevel,
  computeEffectiveStats,
} from "@rotmg/shared";
import type { ISystem } from "./ISystem.js";
import type { GameWorld } from "../GameWorld.js";

export class InventorySystem implements ISystem {
  public readonly name = "InventorySystem";

  public update(_world: GameWorld, _dt: number, _now: number): void {
    // Inventory interactions are event/request driven
  }

  public recomputePlayerStats(world: GameWorld, playerEid: number): void {
    const classId = Progression.classId[playerEid] || "wizard";
    const level = Progression.level[playerEid] || 1;

    const base = computeBaseStatsForLevel(classId, level);
    const eq = {
      weapon: Equipment.weapon[playerEid],
      armor: Equipment.armor[playerEid],
    };
    const effective = computeEffectiveStats(base, eq);

    CombatStats.defense[playerEid] = effective.defense;
    CombatStats.attack[playerEid] = effective.attack;
    CombatStats.dexterity[playerEid] = effective.dexterity;
    CombatStats.speed[playerEid] = effective.speed;
    Speed.value[playerEid] = effective.speed;
    Health.max[playerEid] = effective.maxHp;
    Health.current[playerEid] = Math.min(
      Health.current[playerEid] || effective.maxHp,
      effective.maxHp,
    );
  }

  public handleEquipItem(
    world: GameWorld,
    playerEid: number,
    inventoryIndex: number,
    slot: "weapon" | "armor",
  ): boolean {
    const ecs = world.ecsWorld;
    if (hasComponent(ecs, playerEid, Health) && Health.current[playerEid] <= 0)
      return false;

    const slots = Inventory.slots[playerEid];
    if (!slots) return false;

    const itemToEquip = slots[inventoryIndex];
    if (!itemToEquip) return false;

    const classId = Progression.classId[playerEid];
    const check = canEquipItem(classId, itemToEquip, slot);
    if (!check.canEquip) {
      world.events.emit("chat_broadcast", {
        sender: "Inventory",
        text: check.reason || "Cannot equip item",
        kind: "system",
      });
      return false;
    }

    const previousEquipped = Equipment[slot][playerEid];
    Equipment[slot][playerEid] = itemToEquip;
    slots[inventoryIndex] = previousEquipped;

    this.recomputePlayerStats(world, playerEid);
    return true;
  }

  public handleUnequipItem(
    world: GameWorld,
    playerEid: number,
    slot: "weapon" | "armor",
    targetInventoryIndex?: number,
  ): boolean {
    const ecs = world.ecsWorld;
    if (hasComponent(ecs, playerEid, Health) && Health.current[playerEid] <= 0)
      return false;

    const currentEquipped = Equipment[slot][playerEid];
    if (!currentEquipped) return false;

    const slots = Inventory.slots[playerEid];
    if (!slots) return false;

    let targetIdx = targetInventoryIndex;
    if (
      targetIdx === undefined ||
      targetIdx < 0 ||
      targetIdx >= slots.length ||
      slots[targetIdx] !== null
    ) {
      targetIdx = slots.findIndex((item) => item === null);
    }

    if (targetIdx !== -1) {
      Equipment[slot][playerEid] = null;
      slots[targetIdx] = currentEquipped;
      this.recomputePlayerStats(world, playerEid);
      return true;
    }

    return false;
  }

  public handleSwapSlots(
    world: GameWorld,
    playerEid: number,
    fromIndex: number,
    toIndex: number,
  ): boolean {
    const ecs = world.ecsWorld;
    if (hasComponent(ecs, playerEid, Health) && Health.current[playerEid] <= 0)
      return false;

    const slots = Inventory.slots[playerEid];
    if (!slots) return false;

    if (
      fromIndex < 0 ||
      fromIndex >= slots.length ||
      toIndex < 0 ||
      toIndex >= slots.length
    ) {
      return false;
    }

    const temp = slots[fromIndex];
    slots[fromIndex] = slots[toIndex];
    slots[toIndex] = temp;
    return true;
  }
}
