export type ItemType = "weapon" | "armor";

export type ItemRarity = "common" | "uncommon" | "rare" | "legendary";

export interface BaseItemDefinition {
  id: string;
  name: string;
  type: ItemType;
  rarity: ItemRarity;
  description: string;
  modelId: string;
}

export interface WeaponBulletConfig {
  speed: number;
  lifetime: number;
  color: string;
  radius: number;
  projectilePrefabId?: string;
  shape?: "square" | "rectangular";
}

export type WeaponSubtype = "staff" | "sword";
export type ArmorSubtype = "robe" | "heavy";

export interface WeaponItemDefinition extends BaseItemDefinition {
  type: "weapon";
  weaponSubtype?: WeaponSubtype;
  damage: number;
  attackSpeed: number; // shots per second
  projectileCount: number;
  pattern: "single" | "spread";
  spreadAngle?: number;
  bullet: WeaponBulletConfig;
}

export interface ArmorItemDefinition extends BaseItemDefinition {
  type: "armor";
  armorSubtype?: ArmorSubtype;
  defense: number;
  maxHpBonus?: number;
  maxMpBonus?: number;
}

export type ItemDefinition = WeaponItemDefinition | ArmorItemDefinition;

export interface LootDropEntry {
  itemId: string;
  chance: number; // 0.0 to 1.0 (e.g. 0.35 = 35% chance)
}
