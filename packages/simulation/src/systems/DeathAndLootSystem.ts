import { query, hasComponent } from "bitecs";
import {
  Dead,
  Enemy,
  Player,
  Position,
  Identity,
  CombatStats,
  DropTable,
  Progression,
  Health,
  getXpForNextLevel,
  computeBaseStatsForLevel,
  computeEffectiveStats,
  Equipment,
  LootBag,
} from "@mmoexile/game-core";
import type { ISystem } from "./ISystem.js";
import type { GameWorld } from "../GameWorld.js";

export class DeathAndLootSystem implements ISystem {
  public readonly name = "DeathAndLootSystem";

  public update(world: GameWorld, _dt: number, _now: number): void {
    const ecs = world.ecsWorld;
    const deadEntities = query(ecs, [Dead]);

    for (const eid of deadEntities) {
      const isEnemy = hasComponent(ecs, eid, Enemy);
      const isPlayer = hasComponent(ecs, eid, Player);

      if (isEnemy) {
        // 1. Roll Drop Table
        const drops = DropTable.drops[eid];
        if (drops && drops.length > 0) {
          const droppedItemIds: string[] = [];
          for (const drop of drops) {
            if (Math.random() < drop.chance) {
              droppedItemIds.push(drop.itemId);
            }
          }

          if (droppedItemIds.length > 0) {
            const bagEid = world.entities.spawnLootBag(
              Position.x[eid],
              Position.y[eid],
              droppedItemIds,
            );

            world.recordLootBagSpawned({
              instanceId: world.instanceId,
              bagId: Identity.uuid[bagEid],
              x: Position.x[bagEid],
              y: Position.y[bagEid],
              kind: (LootBag.kind[bagEid] || "bag_brown") as
                | "bag_brown"
                | "bag_cyan",
              itemIds: [...droppedItemIds],
            });
          }
        }

        // 2. Award XP to nearby/all players or killer
        const xpReward = CombatStats.xpReward[eid] ?? 0;
        if (xpReward > 0) {
          const allPlayers = query(ecs, [Player, Progression, Health]);
          for (const pEid of allPlayers) {
            if (Health.current[pEid] > 0) {
              this.addPlayerXp(world, pEid, xpReward);
            }
          }
        }
      }

      // Record entity died event
      world.recordEntityDied({
        entityId: Identity.uuid[eid],
        isPlayer,
      });

      // Remove from world using EntityManager
      world.entities.destroyEntity(eid);
    }
  }

  private addPlayerXp(
    world: GameWorld,
    playerEid: number,
    amount: number,
  ): void {
    const ecs = world.ecsWorld;
    let currentLvl = Progression.level[playerEid];
    if (currentLvl >= 20 || amount <= 0) return;

    Progression.xp[playerEid] = (Progression.xp[playerEid] || 0) + amount;
    let levelsGained = 0;

    while (
      Progression.xp[playerEid] >= getXpForNextLevel(currentLvl) &&
      currentLvl < 20
    ) {
      Progression.xp[playerEid] -= getXpForNextLevel(currentLvl);
      currentLvl += 1;
      Progression.level[playerEid] = currentLvl;
      levelsGained++;

      // Recalculate stats on level-up
      const base = computeBaseStatsForLevel(
        Progression.classId[playerEid],
        currentLvl,
      );
      const eq = {
        weapon: Equipment.weapon[playerEid],
        armor: Equipment.armor[playerEid],
      };
      const effective = computeEffectiveStats(base, eq);

      CombatStats.defense[playerEid] = effective.defense;
      CombatStats.attack[playerEid] = effective.attack;
      CombatStats.dexterity[playerEid] = effective.dexterity;
      CombatStats.speed[playerEid] = effective.speed;
      Health.max[playerEid] = effective.maxHp;
      Health.current[playerEid] = effective.maxHp; // Full heal on level-up
    }

    if (levelsGained > 0) {
      world.recordLevelUp({
        playerId: Identity.uuid[playerEid],
        playerName: Identity.name[playerEid],
        newLevel: currentLvl,
      });
    }
  }
}
