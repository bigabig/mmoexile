import { WeaponItemDefinition } from "../types.js";

export const IronSwordItem: WeaponItemDefinition = {
  id: "sword_iron",
  name: "Iron Broadsword",
  type: "weapon",
  weaponSubtype: "sword",
  rarity: "common",
  description:
    "A heavy, double-edged steel broadsword capable of cleaving foes in close combat.",
  modelId: "sword_iron",
  damage: 42,
  attackSpeed: 2.3, // 2.3 attacks/sec
  projectileCount: 1,
  pattern: "single",
  bullet: {
    speed: 14.0,
    lifetime: 0.35, // 14 * 0.35 = 4.9 tiles range (melee/close range)
    color: "#e2e8f0",
    radius: 0.3,
  },
};
