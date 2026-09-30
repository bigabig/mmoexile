import { WeaponItemDefinition } from "../types.js";

export const FireStaffItem: WeaponItemDefinition = {
  id: "staff_fire",
  name: "Staff of Fire",
  type: "weapon",
  weaponSubtype: "staff",
  rarity: "uncommon",
  description: "An ancient obsidian rod crowned with twin burning ruby flames.",
  modelId: "staff_fire",
  damage: 28,
  attackSpeed: 3.2, // 3.2 shots/sec
  projectileCount: 2,
  pattern: "spread",
  spreadAngle: 0.12,
  bullet: {
    speed: 13.0,
    lifetime: 0.85,
    color: "#ef4444",
    radius: 0.28,
  },
};
