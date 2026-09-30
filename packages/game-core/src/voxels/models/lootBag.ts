import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../types.js";

/**
 * Loot Bag Model (4x5x4)
 */
export function buildLootBagModel(
  color: "brown" | "cyan" = "brown",
): VoxelModel {
  const bagColor = color === "brown" ? "#78350f" : "#06b6d4";
  const ribbonColor = color === "brown" ? "#d97706" : "#ec4899";

  const palette = ["#00000000", bagColor, ribbonColor];
  const model = createEmptyVoxelModel(`bag_${color}`, [4, 5, 4], palette);

  for (let y = 0; y <= 3; y++) {
    for (let x = 0; x < 4; x++) {
      for (let z = 0; z < 4; z++) {
        setVoxel(model, x, y, z, 1);
      }
    }
  }

  // Tied neck & ribbon
  setVoxel(model, 1, 3, 1, 2);
  setVoxel(model, 2, 3, 1, 2);
  setVoxel(model, 1, 3, 2, 2);
  setVoxel(model, 2, 3, 2, 2);
  setVoxel(model, 1, 4, 1, 1);
  setVoxel(model, 2, 4, 2, 1);

  return model;
}
