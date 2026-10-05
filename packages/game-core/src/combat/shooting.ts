import type { ProjectileState } from "./projectile.js";
import { WeaponItemDefinition } from "../items/types.js";

/**
 * Returns the cooldown duration in seconds between weapon attacks.
 */
export function getWeaponAttackCooldown(weapon: WeaponItemDefinition): number {
  return 1 / Math.max(0.1, weapon.attackSpeed);
}

export interface CreateWeaponProjectilesOptions {
  ownerId: string;
  startX: number;
  startY: number;
  baseAngle: number;
  weapon: WeaponItemDefinition;
  isPlayer?: boolean;
  serverTime?: number;
  generateId?: () => string;
}

/**
 * Generates projectile states for a weapon attack, handling single shots and multi-projectile spread cones.
 */
export function createWeaponProjectiles(
  options: CreateWeaponProjectilesOptions,
): ProjectileState[] {
  const {
    ownerId,
    startX,
    startY,
    baseAngle,
    weapon,
    isPlayer = true,
    serverTime = Date.now(),
    generateId = () =>
      `${ownerId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  } = options;

  const count = Math.max(1, weapon.projectileCount || 1);
  const spreadStep = weapon.spreadAngle ?? 0.12; // ~6.8 degrees step by default
  const projectiles: ProjectileState[] = [];

  for (let i = 0; i < count; i++) {
    let angle = baseAngle;
    if (count > 1 && weapon.pattern === "spread") {
      const offset = (i - (count - 1) / 2) * spreadStep;
      angle = baseAngle + offset;
    }

    projectiles.push({
      id: generateId(),
      ownerId,
      isPlayer,
      startX,
      startY,
      angle,
      speed: weapon.bullet.speed,
      lifetime: weapon.bullet.lifetime,
      damage: weapon.damage,
      spawnTime: serverTime,
      color: weapon.bullet.color,
      radius: weapon.bullet.radius,
      piercing: false,
      shape:
        weapon.bullet.projectilePrefabId === "projectile_rectangular"
          ? "rectangular"
          : "square",
    });
  }

  return projectiles;
}
