import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../../../types.js";

/**
 * Iron Broadsword (5x9x3 broadsword with bronze guard and steel double-edged blade)
 */
export function buildIronSwordModel(): VoxelModel {
  const palette = [
    "#00000000",
    "#78350f", // 1: leather wrapped grip
    "#d97706", // 2: bronze pommel & crossguard
    "#e2e8f0", // 3: steel blade
    "#94a3b8", // 4: blade fuller / edge shadow
    "#f8fafc", // 5: blade edge shine
  ];

  const model = createEmptyVoxelModel("sword_iron", [5, 9, 3], palette);

  // Pommel (y: 0, x: 2, z: 1)
  setVoxel(model, 2, 0, 1, 2);

  // Leather Grip (y: 1 to 2, x: 2, z: 1)
  setVoxel(model, 2, 1, 1, 1);
  setVoxel(model, 2, 2, 1, 1);

  // Bronze Crossguard (y: 3, x: 0 to 4, z: 1)
  for (let x = 0; x <= 4; x++) {
    setVoxel(model, x, 3, 1, 2);
  }

  // Steel Blade (y: 4 to 7, x: 1 to 3, z: 1)
  for (let y = 4; y <= 7; y++) {
    setVoxel(model, 1, y, 1, 5); // left edge shine
    setVoxel(model, 2, y, 1, 4); // center fuller
    setVoxel(model, 3, y, 1, 3); // right edge
  }

  // Blade Point (y: 8, x: 2, z: 1)
  setVoxel(model, 2, 8, 1, 5);

  return model;
}
