import { getItemDefinition } from "../items/index.js";
import type {
  WeaponItemDefinition,
  ArmorItemDefinition,
} from "../items/types.js";
import { getClassDefinition } from "./character.js";

/**
 * Checks if an item can be equipped by a character class.
 */
export function canEquipItem(
  classId: string,
  itemId: string,
  slot?: "weapon" | "armor",
): { canEquip: boolean; reason?: string; targetSlot?: "weapon" | "armor" } {
  const itemDef = getItemDefinition(itemId);
  if (!itemDef) {
    return { canEquip: false, reason: "Item does not exist" };
  }

  const classDef = getClassDefinition(classId);
  const classData = classDef.components.Progression?.classData!;

  if (itemDef.type === "weapon") {
    if (slot && slot !== "weapon") {
      return { canEquip: false, reason: "Cannot equip weapon in armor slot" };
    }
    const weaponDef = itemDef as WeaponItemDefinition;
    if (
      weaponDef.weaponSubtype &&
      !classData.allowedWeaponSubtypes.includes(weaponDef.weaponSubtype)
    ) {
      return {
        canEquip: false,
        reason: `${classDef.name} cannot equip ${weaponDef.weaponSubtype} weapons`,
      };
    }
    return { canEquip: true, targetSlot: "weapon" };
  }

  if (itemDef.type === "armor") {
    if (slot && slot !== "armor") {
      return { canEquip: false, reason: "Cannot equip armor in weapon slot" };
    }
    const armorDef = itemDef as ArmorItemDefinition;
    if (
      armorDef.armorSubtype &&
      !classData.allowedArmorSubtypes.includes(armorDef.armorSubtype)
    ) {
      return {
        canEquip: false,
        reason: `${classDef.name} cannot equip ${armorDef.armorSubtype} armor`,
      };
    }
    return { canEquip: true, targetSlot: "armor" };
  }

  return { canEquip: false, reason: "Item is not equippable" };
}
