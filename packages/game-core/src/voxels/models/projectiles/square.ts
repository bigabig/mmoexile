import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../../types.js";

/**
 * Square Projectile Voxel Model (3x3x3 cube)
 */
export function buildSquareProjectileModel(
  primaryColor: string = "#38bdf8",
  coreColor: string = "#e0f2fe",
): VoxelModel {
  const palette = ["#00000000", primaryColor, coreColor];
  const model = createEmptyVoxelModel("projectile_square", [3, 3, 3], palette);

  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) {
      for (let z = 0; z < 3; z++) {
        // Bright core in center
        if (x === 1 && y === 1 && z === 1) {
          setVoxel(model, x, y, z, 2);
        } else {
          setVoxel(model, x, y, z, 1);
        }
      }
    }
  }

  return model;
}

