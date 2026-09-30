import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../../../types.js";

/**
 * Magician Robe (5x6x3 royal purple mantle with gold trim & ruby clasp)
 */
export function buildMagicianRobeModel(): VoxelModel {
  const palette = [
    "#00000000",
    "#7e22ce", // 1: royal purple mantle
    "#581c87", // 2: deep violet shadow
    "#eab308", // 3: gold trim / embroidery
    "#ef4444", // 4: glowing ruby clasp
  ];

  const model = createEmptyVoxelModel("robe_magician", [5, 6, 3], palette);

  // Skirt hemline (y: 0 to 2)
  for (let y = 0; y <= 2; y++) {
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 3; z++) {
        setVoxel(model, x, y, z, 1);
      }
    }
  }

  // Gold trim on lower hem (y: 0)
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

  // Vertical gold seam down front (y: 1 to 4, x=2, z=2)
  setVoxel(model, 2, 1, 2, 3);
  setVoxel(model, 2, 2, 2, 3);
  setVoxel(model, 2, 3, 2, 3);

  // Ruby brooch clasp (y: 4, x=2, z=2)
  setVoxel(model, 2, 4, 2, 4);

  // Shoulders & gold mantle collar (y: 5)
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 3; z++) {
      setVoxel(model, x, 5, z, 1);
    }
  }
  setVoxel(model, 0, 5, 2, 3);
  setVoxel(model, 1, 5, 2, 3);
  setVoxel(model, 3, 5, 2, 3);
  setVoxel(model, 4, 5, 2, 3);

  return model;
}

