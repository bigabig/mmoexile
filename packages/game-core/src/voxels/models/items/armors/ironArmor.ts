import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../../../types.js";

/**
 * Iron Chainmail (5x6x3 reinforced chainmail with solid steel breastplate & pauldrons)
 */
export function buildIronArmorModel(): VoxelModel {
  const palette = [
    "#00000000",
    "#94a3b8", // 1: polished steel plate
    "#64748b", // 2: darkened chainmail
    "#334155", // 3: shadowed steel / rivets
    "#d97706", // 4: bronze buckles
  ];

  const model = createEmptyVoxelModel("armor_iron", [5, 6, 3], palette);

  // Chainmail hauberk waist (y: 0 to 1)
  for (let y = 0; y <= 1; y++) {
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 3; z++) {
        setVoxel(model, x, y, z, 2);
      }
    }
  }

  // Steel Breastplate (y: 2 to 4)
  for (let y = 2; y <= 4; y++) {
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 3; z++) {
        if (z === 2 && (x === 1 || x === 2 || x === 3)) {
          setVoxel(model, x, y, z, 1); // Front chest plate
        } else {
          setVoxel(model, x, y, z, 2); // Chainmail underlayer
        }
      }
    }
  }

  // Bronze rivets on front chest plate
  setVoxel(model, 1, 3, 2, 4);
  setVoxel(model, 3, 3, 2, 4);

  // Pauldrons & collar (y: 5)
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 3; z++) {
      setVoxel(model, x, 5, z, x === 0 || x === 4 ? 1 : 3);
    }
  }

  return model;
}
