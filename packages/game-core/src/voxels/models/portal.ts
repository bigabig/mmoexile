import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../types.js";

/**
 * Realm / Dungeon / Nexus Portal Model (8x10x4)
 */
export function buildPortalModel(
  kind: "realm" | "dungeon" | "nexus" = "realm",
): VoxelModel {
  const isRealm = kind === "realm";
  const isDungeon = kind === "dungeon";
  const vortexColor1 = isRealm ? "#a855f7" : isDungeon ? "#06b6d4" : "#eab308";
  const vortexColor2 = isRealm ? "#7e22ce" : isDungeon ? "#0891b2" : "#ca8a04";
  const stoneColor = isRealm ? "#334155" : isDungeon ? "#1e293b" : "#cbd5e1";

  const palette = [
    "#00000000",
    stoneColor, // 1: frame
    "#64748b", // 2: stone accent
    vortexColor1, // 3: inner swirling vortex
    vortexColor2, // 4: deep vortex
  ];

  const model = createEmptyVoxelModel(`portal_${kind}`, [8, 10, 4], palette);

  // Stone Base
  for (let x = 0; x < 8; x++) {
    for (let z = 0; z < 4; z++) {
      setVoxel(model, x, 0, z, 1);
    }
  }

  // Side Pillars
  for (let y = 1; y < 9; y++) {
    for (let z = 1; z <= 2; z++) {
      setVoxel(model, 0, y, z, 1);
      setVoxel(model, 1, y, z, 2);
      setVoxel(model, 6, y, z, 2);
      setVoxel(model, 7, y, z, 1);
    }
  }

  // Top Arch
  for (let x = 0; x < 8; x++) {
    for (let z = 1; z <= 2; z++) {
      setVoxel(model, x, 9, z, 1);
    }
  }

  // Swirling Vortex Center
  for (let y = 1; y < 9; y++) {
    for (let x = 2; x <= 5; x++) {
      const col = (x + y) % 2 === 0 ? 3 : 4;
      setVoxel(model, x, y, 1, col);
      setVoxel(model, x, y, 2, col);
    }
  }

  return model;
}
