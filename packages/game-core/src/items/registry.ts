import { ItemDefinition } from "./types.js";
import { EnergyStaffItem } from "./weapons/energyStaff.js";
import { FireStaffItem } from "./weapons/fireStaff.js";
import { IronSwordItem } from "./weapons/ironSword.js";
import { ApprenticeRobeItem } from "./armors/apprenticeRobe.js";
import { MagicianRobeItem } from "./armors/magicianRobe.js";
import { IronArmorItem } from "./armors/ironArmor.js";

export const ITEMS_REGISTRY: Record<string, ItemDefinition> = {
  staff_energy: EnergyStaffItem,
  staff_fire: FireStaffItem,
  sword_iron: IronSwordItem,
  robe_apprentice: ApprenticeRobeItem,
  robe_magician: MagicianRobeItem,
  armor_iron: IronArmorItem,
};

export function getItemDefinition(id: string): ItemDefinition | undefined {
  return ITEMS_REGISTRY[id];
}
