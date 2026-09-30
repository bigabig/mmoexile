import { VoxelModel } from "../types.js";
import { buildWizardModel, buildKnightModel } from "./characters/index.js";
import {
  buildSlimeModel,
  buildPirateModel,
  buildGolemBossModel,
} from "./enemies/index.js";
import {
  buildEnergyStaffModel,
  buildFireStaffModel,
  buildIronSwordModel,
  buildApprenticeRobeModel,
  buildMagicianRobeModel,
  buildIronArmorModel,
} from "./items/index.js";
import { buildPortalModel } from "./portal.js";
import { buildLootBagModel } from "./lootBag.js";
import {
  buildSquareProjectileModel,
  buildRectangularProjectileModel,
} from "./projectiles/index.js";

export * from "./characters/index.js";
export * from "./enemies/index.js";
export * from "./items/index.js";
export * from "./projectiles/index.js";
export { buildPortalModel } from "./portal.js";
export { buildLootBagModel } from "./lootBag.js";

export const BUILTIN_VOXEL_MODELS: Record<string, VoxelModel> = {
  player: buildWizardModel(),
  wizard: buildWizardModel(),
  knight: buildKnightModel(),
  slime: buildSlimeModel(),
  pirate: buildPirateModel(),
  golem_boss: buildGolemBossModel(),
  portal_realm: buildPortalModel("realm"),
  portal_dungeon: buildPortalModel("dungeon"),
  portal_nexus: buildPortalModel("nexus"),
  bag_brown: buildLootBagModel("brown"),
  bag_cyan: buildLootBagModel("cyan"),
  staff_energy: buildEnergyStaffModel(),
  staff_fire: buildFireStaffModel(),
  sword_iron: buildIronSwordModel(),
  robe_apprentice: buildApprenticeRobeModel(),
  robe_magician: buildMagicianRobeModel(),
  armor_iron: buildIronArmorModel(),
  projectile_square: buildSquareProjectileModel(),
  projectile_rectangular: buildRectangularProjectileModel(),
};
