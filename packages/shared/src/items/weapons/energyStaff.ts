import { WeaponItemDefinition } from "../types.js";

export const EnergyStaffItem: WeaponItemDefinition = {
  id: "staff_energy",
  name: "Staff of Energy",
  type: "weapon",
  weaponSubtype: "staff",
  rarity: "common",
  description:
    "A carved wooden staff bound with a focused cyan energy crystal.",
  modelId: "staff_energy",
  damage: 32,
  attackSpeed: 3.5, // 3.5 shots/sec
  projectileCount: 1,
  pattern: "single",
  bullet: {
    speed: 12.0,
    lifetime: 0.8,
    color: "#06b6d4",
    radius: 0.25,
  },
};
