import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../../types.js";

/**
 * Basic Slime enemy (6x6x6 green jelly)
 */
export function buildSlimeModel(): VoxelModel {
  const palette = [
    "#00000000",
    "#22c55e", // outer green
    "#15803d", // darker green
    "#86efac", // light green highlight
    "#ef4444", // red core/eyes
  ];
  const model = createEmptyVoxelModel("slime", [6, 6, 6], palette);

  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 6; x++) {
      for (let z = 0; z < 6; z++) {
        const isBorder =
          x === 0 || x === 5 || z === 0 || z === 5 || y === 0 || y === 4;
        if (isBorder) {
          setVoxel(model, x, y, z, 1);
        } else {
          setVoxel(model, x, y, z, 2);
        }
      }
    }
  }

  // Top round cap
  for (let x = 1; x < 5; x++) {
    for (let z = 1; z < 5; z++) {
      setVoxel(model, x, 5, z, 3);
    }
  }

  // Slime eyes (+Z face)
  setVoxel(model, 1, 2, 5, 4);
  setVoxel(model, 4, 2, 5, 4);

  return model;
}
