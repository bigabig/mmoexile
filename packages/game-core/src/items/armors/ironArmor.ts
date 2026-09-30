import { ArmorItemDefinition } from "../types.js";

export const IronArmorItem: ArmorItemDefinition = {
  id: "armor_iron",
  name: "Iron Chainmail",
  type: "armor",
  armorSubtype: "heavy",
  rarity: "common",
  description:
    "Reinforced iron chainmail layered beneath hardened steel pauldron plating.",
  modelId: "armor_iron",
  defense: 8,
  maxHpBonus: 25,
};
