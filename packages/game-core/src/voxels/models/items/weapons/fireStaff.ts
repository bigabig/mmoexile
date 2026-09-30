import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../../../types.js";

/**
 * Fire Staff (3x9x3 obsidian shaft with flaming crimson/gold ruby crystal head)
 */
export function buildFireStaffModel(): VoxelModel {
  const palette = [
    "#00000000",
    "#1e293b", // 1: obsidian shaft
    "#f59e0b", // 2: brass/gold ornament
    "#ef4444", // 3: crimson ruby
    "#fbbf24", // 4: flame highlight
  ];

  const model = createEmptyVoxelModel("staff_fire", [3, 9, 3], palette);

  // Shaft (y: 0 to 5, center x=1, z=1)
  for (let y = 0; y <= 5; y++) {
    setVoxel(model, 1, y, 1, 1);
  }

  // Brass cradle (y: 5 to 6)
  setVoxel(model, 0, 5, 1, 2);
  setVoxel(model, 2, 5, 1, 2);
  setVoxel(model, 0, 6, 1, 2);
  setVoxel(model, 2, 6, 1, 2);

  // Blazing Ruby Core (y: 6 to 8)
  setVoxel(model, 1, 6, 1, 3);
  setVoxel(model, 1, 6, 0, 4);
  setVoxel(model, 1, 6, 2, 3);

  setVoxel(model, 1, 7, 1, 3);
  setVoxel(model, 0, 7, 1, 4);
  setVoxel(model, 2, 7, 1, 4);
  setVoxel(model, 1, 7, 0, 3);
  setVoxel(model, 1, 7, 2, 4);

  // Flame Crown Tip (y: 8)
  setVoxel(model, 1, 8, 1, 4);

  return model;
}

