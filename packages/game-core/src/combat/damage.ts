/**
 * Computes actual damage dealt to a target entity considering its defense.
 * Follows the classic RotMG damage formula with a minimum 15% chip damage floor.
 */
export function calculateDamage(
  rawDamage: number,
  targetDefense: number = 0,
): number {
  const safeDefense = Math.max(0, targetDefense);
  const minDamage = Math.max(1, Math.floor(rawDamage * 0.15));
  return Math.max(minDamage, Math.round(rawDamage - safeDefense));
}

export interface DamageResult {
  damageDealt: number;
  currentHp: number;
  isFatal: boolean;
}

export interface DamageEvent {
  targetId: string;
  damage: number;
  currentHp: number;
  isFatal: boolean;
  killerId?: string;
}

/**
 * Applies damage to an entity's HP after calculating defense mitigation.
 */
export function applyDamage(
  target: { hp: number; defense?: number },
  rawDamage: number,
): DamageResult {
  const damageDealt = calculateDamage(rawDamage, target.defense ?? 0);
  target.hp = Math.max(0, target.hp - damageDealt);
  return {
    damageDealt,
    currentHp: target.hp,
    isFatal: target.hp <= 0,
  };
}
