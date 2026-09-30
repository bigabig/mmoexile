import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../../../types.js";

/**
 * Energy Staff (3x8x3 wood staff with cyan energy crystal)
 */
export function buildEnergyStaffModel(): VoxelModel {
  const palette = [
    "#00000000",
    "#854d0e", // 1: wood shaft
    "#eab308", // 2: gold collar
    "#06b6d4", // 3: glowing cyan crystal
    "#67e8f9", // 4: crystal highlight
  ];

  const model = createEmptyVoxelModel("staff_energy", [3, 8, 3], palette);

  // Shaft (y: 0 to 5, center x=1, z=1)
  for (let y = 0; y <= 5; y++) {
    setVoxel(model, 1, y, 1, 1);
  }

  // Gold collar (y: 5)
  setVoxel(model, 0, 5, 1, 2);
  setVoxel(model, 2, 5, 1, 2);
  setVoxel(model, 1, 5, 0, 2);
  setVoxel(model, 1, 5, 2, 2);

  // Cyan Crystal Head (y: 6 to 7)
  setVoxel(model, 1, 6, 1, 3);
  setVoxel(model, 0, 6, 1, 4);
  setVoxel(model, 2, 6, 1, 3);
  setVoxel(model, 1, 6, 0, 3);
  setVoxel(model, 1, 6, 2, 4);
  setVoxel(model, 1, 7, 1, 4);

  return model;
}

