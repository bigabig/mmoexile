import { query, hasComponent } from "bitecs";
import {
  LootBagTag,
  LootBag,
  Position,
  Inventory,
  Equipment,
  Identity,
  Model,
  Health,
  getItemDefinition,
  vec2Dist,
} from "@mmoexile/shared";
import type { ISystem } from "./ISystem.js";
import type { GameWorld } from "../GameWorld.js";

export class LootSystem implements ISystem {
  public readonly name = "LootSystem";

  public update(world: GameWorld, _dt: number, now: number): void {
    const ecs = world.ecsWorld;
    const bags = query(ecs, [LootBagTag, LootBag, Position]);

    for (const eid of bags) {
      const createdAt = LootBag.createdAt[eid];
      const maxLifetime = LootBag.maxLifetimeMs[eid] || 60000;

      if (now - createdAt > maxLifetime) {
        const bagId = Identity.uuid[eid];
        world.recordLootBagDespawned({
          worldId: world.worldId,
          bagId,
        });

        world.entities.destroyEntity(eid);
      }
    }
  }

  public recalculateBagTier(bagEid: number): "bag_brown" | "bag_cyan" {
    const items = LootBag.itemIds[bagEid] || [];
    const hasUncommonOrBetter = items.some((itemId) => {
      const def = getItemDefinition(itemId);
      return (
        def?.rarity === "uncommon" ||
        def?.rarity === "rare" ||
        def?.rarity === "legendary"
      );
    });
    const kind: "bag_brown" | "bag_cyan" = hasUncommonOrBetter
      ? "bag_cyan"
      : "bag_brown";
    LootBag.kind[bagEid] = kind;
    Model.modelId[bagEid] = kind;
    return kind;
  }

  public handleLootItem(
    world: GameWorld,
    playerEid: number,
    bagId: string,
    itemIndex?: number,
  ): boolean {
    const ecs = world.ecsWorld;
    if (hasComponent(ecs, playerEid, Health) && Health.current[playerEid] <= 0)
      return false;

    const bagEid = world.uuidToEid.get(bagId);
    if (bagEid === undefined || !hasComponent(ecs, bagEid, LootBagTag))
      return false;

    const playerPos = { x: Position.x[playerEid], y: Position.y[playerEid] };
    const bagPos = { x: Position.x[bagEid], y: Position.y[bagEid] };

    if (vec2Dist(playerPos, bagPos) > 2.2) {
      return false;
    }

    const slots = Inventory.slots[playerEid];
    if (!slots) return false;

    if (itemIndex === undefined) {
      return this.handleLootAll(world, playerEid, bagId);
    }

    const emptyIdx = slots.findIndex((item) => item === null);
    if (emptyIdx === -1) {
      world.events.emit("chat_broadcast", {
        sender: "Inventory",
        text: "Inventory is full!",
        kind: "system",
      });
      return false;
    }

    const bagItems = LootBag.itemIds[bagEid];
    if (bagItems && itemIndex >= 0 && itemIndex < bagItems.length) {
      const lootedItemId = bagItems.splice(itemIndex, 1)[0];
      slots[emptyIdx] = lootedItemId;

      if (bagItems.length === 0) {
        world.recordLootBagDespawned({
          worldId: world.worldId,
          bagId,
        });
        world.entities.destroyEntity(bagEid);
      } else {
        this.recalculateBagTier(bagEid);
      }
      return true;
    }

    return false;
  }

  public handleLootAll(
    world: GameWorld,
    playerEid: number,
    bagId: string,
  ): boolean {
    const ecs = world.ecsWorld;
    if (hasComponent(ecs, playerEid, Health) && Health.current[playerEid] <= 0)
      return false;

    const bagEid = world.uuidToEid.get(bagId);
    if (bagEid === undefined || !hasComponent(ecs, bagEid, LootBagTag))
      return false;

    const playerPos = { x: Position.x[playerEid], y: Position.y[playerEid] };
    const bagPos = { x: Position.x[bagEid], y: Position.y[bagEid] };

    if (vec2Dist(playerPos, bagPos) > 2.2) {
      return false;
    }

    const slots = Inventory.slots[playerEid];
    if (!slots) return false;

    const bagItems = LootBag.itemIds[bagEid];
    if (!bagItems || bagItems.length === 0) return false;

    let lootedAny = false;
    for (let i = bagItems.length - 1; i >= 0; i--) {
      const emptyIdx = slots.findIndex((item) => item === null);
      if (emptyIdx === -1) {
        world.events.emit("chat_broadcast", {
          sender: "Inventory",
          text: "Inventory is full!",
          kind: "system",
        });
        break;
      }

      const itemId = bagItems.splice(i, 1)[0];
      slots[emptyIdx] = itemId;
      lootedAny = true;
    }

    if (bagItems.length === 0) {
      world.recordLootBagDespawned({
        worldId: world.worldId,
        bagId,
      });
      world.entities.destroyEntity(bagEid);
    } else {
      this.recalculateBagTier(bagEid);
    }

    return lootedAny;
  }

  public handleDropItem(
    world: GameWorld,
    playerEid: number,
    fromSlot: "inventory" | "weapon" | "armor",
    inventoryIndex?: number,
  ): boolean {
    const ecs = world.ecsWorld;
    if (hasComponent(ecs, playerEid, Health) && Health.current[playerEid] <= 0)
      return false;

    let droppedItemId: string | null = null;
    const slots = Inventory.slots[playerEid];

    if (fromSlot === "inventory") {
      if (
        inventoryIndex === undefined ||
        inventoryIndex < 0 ||
        inventoryIndex >= (slots?.length || 0) ||
        !slots ||
        slots[inventoryIndex] === null
      ) {
        return false;
      }
      droppedItemId = slots[inventoryIndex];
      slots[inventoryIndex] = null;
    } else if (fromSlot === "weapon") {
      droppedItemId = Equipment.weapon[playerEid];
      Equipment.weapon[playerEid] = null;
      world.inventory.recomputePlayerStats(world, playerEid);
    } else if (fromSlot === "armor") {
      droppedItemId = Equipment.armor[playerEid];
      Equipment.armor[playerEid] = null;
      world.inventory.recomputePlayerStats(world, playerEid);
    }

    if (!droppedItemId) return false;

    // Check if there is already a nearby loot bag to merge into
    const playerPos = { x: Position.x[playerEid], y: Position.y[playerEid] };
    const nearbyBagEids = world.spatial.queryRadius(
      world,
      playerPos,
      1.2,
      "item",
    );

    let targetBagEid = nearbyBagEids[0];

    if (targetBagEid !== undefined) {
      LootBag.itemIds[targetBagEid].push(droppedItemId);
      this.recalculateBagTier(targetBagEid);
    } else {
      targetBagEid = world.entities.spawnLootBag(playerPos.x, playerPos.y, [
        droppedItemId,
      ]);

      world.recordLootBagSpawned({
        worldId: world.worldId,
        bagId: Identity.uuid[targetBagEid],
        x: Position.x[targetBagEid],
        y: Position.y[targetBagEid],
        kind: (LootBag.kind[targetBagEid] || "bag_brown") as
          | "bag_brown"
          | "bag_cyan",
        itemIds: [droppedItemId],
      });
    }

    return true;
  }
}
