import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../../types.js";

/**
 * Builds the player Wizard voxel model:
 * 8 wide (X), 12 high (Y), 8 deep (Z)
 * Robes (blue), belt/trim (gold), head (skin tone), wizard hat (dark blue), staff (wood & cyan crystal).
 */
export function buildWizardModel(): VoxelModel {
  const palette = [
    "#00000000", // 0: empty
    "#2563eb", // 1: robe blue
    "#1d4ed8", // 2: dark robe blue
    "#fbbf24", // 3: gold trim / belt
    "#fde047", // 4: bright gold buckle
    "#fbcfe8", // 5: skin tone
    "#1e293b", // 6: eyes / boots
    "#38bdf8", // 7: staff crystal cyan
    "#78350f", // 8: staff wood brown
  ];

  const model = createEmptyVoxelModel("player", [8, 12, 8], palette);

  // Boots (Y = 0)
  for (let z = 2; z <= 5; z++) {
    setVoxel(model, 2, 0, z, 6);
    setVoxel(model, 5, 0, z, 6);
  }

  // Robe / Body (Y = 1 to 6)
  for (let y = 1; y <= 6; y++) {
    for (let x = 1; x <= 6; x++) {
      for (let z = 1; z <= 6; z++) {
        if (y >= 4 && (x === 1 || x === 6 || z === 1 || z === 6)) {
          setVoxel(model, x, y, z, 2);
        } else {
          setVoxel(model, x, y, z, 1);
        }
      }
    }
  }

  // Gold Belt (Y = 4)
  for (let x = 1; x <= 6; x++) {
    setVoxel(model, x, 4, 1, 3);
    setVoxel(model, x, 4, 6, 3);
  }
  setVoxel(model, 3, 4, 1, 4);
  setVoxel(model, 4, 4, 1, 4);

  // Head (Y = 7 to 9)
  for (let y = 7; y <= 9; y++) {
    for (let x = 2; x <= 5; x++) {
      for (let z = 2; z <= 5; z++) {
        setVoxel(model, x, y, z, 5);
      }
    }
  }

  // Eyes on face (+Z)
  setVoxel(model, 2, 8, 5, 6);
  setVoxel(model, 5, 8, 5, 6);

  // Wizard Hat brim (Y = 9)
  for (let x = 1; x <= 6; x++) {
    for (let z = 1; z <= 6; z++) {
      if (x === 1 || x === 6 || z === 1 || z === 6) {
        setVoxel(model, x, 9, z, 2);
      }
    }
  }

  // Wizard Hat cone (Y = 10 to 11)
  for (let x = 2; x <= 5; x++) {
    for (let z = 2; z <= 5; z++) {
      setVoxel(model, x, 10, z, 1);
    }
  }
  setVoxel(model, 3, 11, 3, 1);
  setVoxel(model, 4, 11, 3, 1);
  setVoxel(model, 3, 11, 4, 1);
  setVoxel(model, 4, 11, 4, 1);

  // Staff on right hand (X = 7, Y = 2 to 9)
  for (let y = 2; y <= 8; y++) {
    setVoxel(model, 7, y, 4, 8);
  }
  // Crystal at top of staff
  setVoxel(model, 7, 9, 4, 7);

  return model;
}
