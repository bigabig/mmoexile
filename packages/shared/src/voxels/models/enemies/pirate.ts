import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../../types.js";

/**
 * Pirate / Bandit enemy (8x10x8)
 */
export function buildPirateModel(): VoxelModel {
  const palette = [
    "#00000000",
    "#dc2626", // red bandana
    "#fde047", // pirate gold
    "#78350f", // brown vest
    "#fbcfe8", // skin
    "#18181b", // eyepatch / black boots
    "#94a3b8", // cutlass steel
  ];
  const model = createEmptyVoxelModel("pirate", [8, 10, 8], palette);

  // Boots
  for (let z = 2; z <= 5; z++) {
    setVoxel(model, 2, 0, z, 5);
    setVoxel(model, 5, 0, z, 5);
  }

  // Body / Vest
  for (let y = 1; y <= 5; y++) {
    for (let x = 2; x <= 5; x++) {
      for (let z = 2; z <= 5; z++) {
        setVoxel(model, x, y, z, 3);
      }
    }
  }

  // Head
  for (let y = 6; y <= 8; y++) {
    for (let x = 2; x <= 5; x++) {
      for (let z = 2; z <= 5; z++) {
        setVoxel(model, x, y, z, 4);
      }
    }
  }

  // Eyepatch & eye (+Z face)
  setVoxel(model, 2, 7, 5, 5);
  setVoxel(model, 4, 7, 5, 5);

  // Bandana
  for (let x = 1; x <= 6; x++) {
    for (let z = 1; z <= 6; z++) {
      setVoxel(model, x, 9, z, 1);
    }
  }

  // Cutlass sword in hand
  for (let y = 2; y <= 6; y++) {
    setVoxel(model, 7, y, 4, 6);
  }

  return model;
}
