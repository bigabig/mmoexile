import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../../types.js";

/**
 * Dungeon Boss Golem (12x14x12)
 */
export function buildGolemBossModel(): VoxelModel {
  const palette = [
    "#00000000",
    "#475569", // stone dark
    "#64748b", // stone mid
    "#94a3b8", // stone light
    "#ef4444", // glowing magma core / eye
    "#f97316", // orange magma
  ];
  const model = createEmptyVoxelModel("golem_boss", [12, 14, 12], palette);

  // Heavy stone legs
  for (let y = 0; y <= 3; y++) {
    for (let x = 1; x <= 4; x++) {
      for (let z = 3; z <= 8; z++) {
        setVoxel(model, x, y, z, 1);
      }
    }
    for (let x = 7; x <= 10; x++) {
      for (let z = 3; z <= 8; z++) {
        setVoxel(model, x, y, z, 1);
      }
    }
  }

  // Massive Torso with Magma core
  for (let y = 4; y <= 9; y++) {
    for (let x = 1; x <= 10; x++) {
      for (let z = 2; z <= 9; z++) {
        const isCore = x >= 4 && x <= 7 && y >= 5 && y <= 7 && z === 9;
        if (isCore) {
          setVoxel(model, x, y, z, 5);
        } else {
          setVoxel(model, x, y, z, (x + y + z) % 2 === 0 ? 1 : 2);
        }
      }
    }
  }

  // Heavy stone shoulders & arms
  for (let y = 3; y <= 9; y++) {
    for (let z = 3; z <= 7; z++) {
      setVoxel(model, 0, y, z, 1);
      setVoxel(model, 11, y, z, 1);
    }
  }

  // Stone head
  for (let y = 10; y <= 13; y++) {
    for (let x = 3; x <= 8; x++) {
      for (let z = 3; z <= 8; z++) {
        setVoxel(model, x, y, z, 2);
      }
    }
  }

  // Fiery glowing eyes (+Z)
  setVoxel(model, 4, 11, 8, 4);
  setVoxel(model, 7, 11, 8, 4);

  return model;
}
