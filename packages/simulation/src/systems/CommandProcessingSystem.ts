import { hasComponent } from "bitecs";
import { Player, Health, InputQueue } from "@mmoexile/game-core";
import type { ISystem } from "./ISystem.js";
import type { GameWorld } from "../GameWorld.js";

export class CommandProcessingSystem implements ISystem {
  public readonly name = "CommandProcessingSystem";

  public update(world: GameWorld, _dt: number, _now: number): void {
    const commands = world.commandQueue.drain();
    if (commands.length === 0) return;

    const ecs = world.ecsWorld;

    for (const { playerId, command } of commands) {
      const eid = world.uuidToEid.get(playerId);
      if (eid === undefined || !hasComponent(ecs, eid, Player)) continue;

      const isAlive = Health.current[eid] > 0;
      if (!isAlive) continue;

      switch (command.type) {
        case "move": {
          if (!InputQueue.inputs[eid]) {
            InputQueue.inputs[eid] = [];
          }
          InputQueue.inputs[eid].push({
            seq: command.seq,
            moveX: command.moveX,
            moveY: command.moveY,
            angle: command.angle,
            dt: command.dt,
          });
          break;
        }

        case "shoot": {
          world.combat.handlePlayerShoot(world, eid, command.angle);
          break;
        }

        case "interact": {
          world.movement.handleInteract(world, eid);
          break;
        }

        case "loot_item": {
          world.loot.handleLootItem(
            world,
            eid,
            command.bagId,
            command.itemIndex,
          );
          break;
        }

        case "loot_all": {
          world.loot.handleLootAll(world, eid, command.bagId);
          break;
        }

        case "equip_item": {
          world.inventory.handleEquipItem(
            world,
            eid,
            command.inventoryIndex,
            command.slot,
          );
          break;
        }

        case "unequip_item": {
          world.inventory.handleUnequipItem(
            world,
            eid,
            command.slot,
            command.targetInventoryIndex,
          );
          break;
        }

        case "swap_slots": {
          world.inventory.handleSwapSlots(
            world,
            eid,
            command.fromIndex,
            command.toIndex,
          );
          break;
        }

        case "drop_item": {
          world.loot.handleDropItem(
            world,
            eid,
            command.fromSlot,
            command.inventoryIndex,
          );
          break;
        }
      }
    }
  }
}

