import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../../../types.js";

/**
 * Apprentice Robe (5x6x3 blue woven cloth with white trim)
 */
export function buildApprenticeRobeModel(): VoxelModel {
  const palette = [
    "#00000000",
    "#2563eb", // 1: primary blue cloth
    "#1d4ed8", // 2: darker blue shading
    "#f8fafc", // 3: white trim / collar
  ];

  const model = createEmptyVoxelModel("robe_apprentice", [5, 6, 3], palette);

  // Robe body skirt (y: 0 to 2)
  for (let y = 0; y <= 2; y++) {
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 3; z++) {
        setVoxel(model, x, y, z, 1);
      }
    }
  }

  // Hemline trim (y: 0)
  for (let x = 0; x < 5; x++) {
    setVoxel(model, x, 0, 2, 3);
  }

  // Chest & sleeves (y: 3 to 4)
  for (let y = 3; y <= 4; y++) {
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 3; z++) {
        const isCenter = x === 2 && z === 2;
        setVoxel(model, x, y, z, isCenter ? 2 : 1);
      }
    }
  }

  // Shoulders & white collar (y: 5)
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 3; z++) {
      setVoxel(model, x, 5, z, 1);
    }
  }
  setVoxel(model, 1, 5, 2, 3);
  setVoxel(model, 2, 5, 2, 3);
  setVoxel(model, 3, 5, 2, 3);

  return model;
}

