import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../../types.js";

/**
 * Rectangular Projectile Voxel Model (2x2x6 elongated bolt / arrow)
 */
export function buildRectangularProjectileModel(
  shaftColor: string = "#f59e0b",
  tipColor: string = "#fef3c7",
): VoxelModel {
  const palette = ["#00000000", shaftColor, tipColor];
  const model = createEmptyVoxelModel(
    "projectile_rectangular",
    [2, 2, 6],
    palette,
  );

  // Shaft (z = 0 to 4)
  for (let z = 0; z < 5; z++) {
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        setVoxel(model, x, y, z, 1);
      }
    }
  }

  // Glowing arrow / bolt tip (z = 5)
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 2; y++) {
      setVoxel(model, x, y, 5, 2);
    }
  }

  return model;
}
