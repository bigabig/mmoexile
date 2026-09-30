import { query, addComponent, removeComponent } from "bitecs";
import {
  Health,
  Damage,
  CombatStats,
  Identity,
  Dead,
  calculateDamage,
} from "@mmoexile/shared";
import type { ISystem } from "./ISystem.js";
import type { GameWorld } from "../GameWorld.js";

export class DamageSystem implements ISystem {
  public readonly name = "DamageSystem";

  public update(world: GameWorld, _dt: number, _now: number): void {
    const ecs = world.ecsWorld;
    const damagedEntities = query(ecs, [Health, Damage]);

    for (const eid of damagedEntities) {
      const incoming = Damage.amount[eid];
      const sourceEid = Damage.sourceEid[eid];

      if (incoming > 0) {
        const defense = CombatStats.defense[eid] ?? 0;
        const actualDamage = calculateDamage(incoming, defense);

        Health.current[eid] -= actualDamage;

        world.recordDamageDealt({
          targetId: Identity.uuid[eid],
          damage: actualDamage,
          currentHp: Math.max(0, Health.current[eid]),
          isFatal: Health.current[eid] <= 0,
          killerId:
            sourceEid !== undefined && sourceEid !== 0
              ? (Identity.uuid[sourceEid] ?? String(sourceEid))
              : undefined,
        });
      }

      // Clear Damage component
      removeComponent(ecs, eid, Damage);
      Damage.amount[eid] = 0;

      // Check for death
      if (Health.current[eid] <= 0) {
        Health.current[eid] = 0;
        addComponent(ecs, eid, Dead);
      }
    }
  }
}
