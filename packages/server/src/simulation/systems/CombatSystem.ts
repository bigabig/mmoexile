import { query, addComponent, hasComponent } from "bitecs";
import {
  Position,
  Equipment,
  Shooter,
  Health,
  Projectile,
  ProjectileTag,
  Damage,
  Collider,
  circleIntersectsCircle,
  getItemDefinition,
  createWeaponProjectiles,
  getWeaponAttackCooldown,
  type WeaponItemDefinition,
} from "@mmoexile/game-core";
import type { ISystem } from "./ISystem.js";
import type { GameWorld } from "../GameWorld.js";

export class CombatSystem implements ISystem {
  public readonly name = "CombatSystem";

  public handleShoot(world: GameWorld, playerEid: number, angle: number): void {
    this.handlePlayerShoot(world, playerEid, angle);
  }

  public handlePlayerShoot(
    world: GameWorld,
    playerEid: number,
    angle: number,
  ): void {
    const ecs = world.ecsWorld;
    if (hasComponent(ecs, playerEid, Health) && Health.current[playerEid] <= 0)
      return;
    if (
      hasComponent(ecs, playerEid, Shooter) &&
      Shooter.cooldownTimer[playerEid] > 0
    )
      return;

    Position.angle[playerEid] = angle;
    const weaponId = Equipment.weapon[playerEid];
    if (!weaponId) return;

    const weaponDef = getItemDefinition(weaponId) as
      | WeaponItemDefinition
      | undefined;
    if (!weaponDef || weaponDef.type !== "weapon") return;

    Shooter.cooldownTimer[playerEid] = getWeaponAttackCooldown(weaponDef);

    const bullets = createWeaponProjectiles({
      ownerId: String(playerEid),
      startX: Position.x[playerEid],
      startY: Position.y[playerEid],
      baseAngle: angle,
      weapon: weaponDef,
      isPlayer: true,
      serverTime: Date.now(),
    });

    const prefabId =
      weaponDef.weaponSubtype === "sword"
        ? "projectile_rectangular"
        : "projectile_square";

    for (const b of bullets) {
      world.entities.spawnProjectile({
        ownerEid: playerEid,
        isPlayer: true,
        startX: b.startX,
        startY: b.startY,
        angle: b.angle,
        speed: b.speed,
        lifetime: b.lifetime,
        damage: b.damage,
        color: b.color,
        radius: b.radius,
        piercing: b.piercing,
        prefabId,
      });
    }
  }

  public update(world: GameWorld, dt: number, now: number): void {
    const ecs = world.ecsWorld;

    // 1. Decrement weapon cooldowns
    const shooters = query(ecs, [Shooter]);
    for (const sEid of shooters) {
      if (Shooter.cooldownTimer[sEid] > 0) {
        Shooter.cooldownTimer[sEid] -= dt;
      }
    }

    // 2. Simulate active projectiles
    const bullets = query(ecs, [ProjectileTag, Position, Projectile]);

    for (const bEid of bullets) {
      const spawnTime = Projectile.spawnTime[bEid];
      const lifetime = Projectile.lifetime[bEid];
      const age = (now - spawnTime) / 1000;

      if (age >= lifetime) {
        world.entities.destroyEntity(bEid);
        continue;
      }

      const speed = Projectile.speed[bEid];
      const startX = Projectile.startX[bEid];
      const startY = Projectile.startY[bEid];
      const angle = Position.angle[bEid];

      const curX = startX + Math.cos(angle) * speed * age;
      const curY = startY + Math.sin(angle) * speed * age;

      Position.x[bEid] = curX;
      Position.y[bEid] = curY;

      // Wall collision check
      if (world.isSolid(Math.floor(curX), Math.floor(curY))) {
        world.entities.destroyEntity(bEid);
        continue;
      }

      const isPlayerBullet = Projectile.isPlayer[bEid];
      const targetLayer = isPlayerBullet ? "enemy" : "player";
      const bRadius = Collider.radius[bEid] || 0.3;

      const candidates = world.spatial.queryRadius(
        world,
        { x: curX, y: curY },
        bRadius,
        targetLayer,
      );

      let hit = false;
      for (const targetEid of candidates) {
        if (targetEid === Projectile.ownerEid[bEid]) continue;
        if (
          hasComponent(ecs, targetEid, Health) &&
          Health.current[targetEid] <= 0
        )
          continue;

        const targetPos = {
          x: Position.x[targetEid],
          y: Position.y[targetEid],
        };
        const targetRadius = Collider.radius[targetEid] || 0.4;

        if (
          circleIntersectsCircle(
            { x: curX, y: curY },
            bRadius,
            targetPos,
            targetRadius,
          )
        ) {
          // Attach damage to target entity
          addComponent(ecs, targetEid, Damage);
          Damage.amount[targetEid] =
            (Damage.amount[targetEid] || 0) + Projectile.damage[bEid];
          Damage.sourceEid[targetEid] = Projectile.ownerEid[bEid];

          hit = true;
          if (!Projectile.piercing[bEid]) {
            break;
          }
        }
      }

      if (hit && !Projectile.piercing[bEid]) {
        world.entities.destroyEntity(bEid);
      }
    }
  }
}
