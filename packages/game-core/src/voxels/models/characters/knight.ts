import { VoxelModel, createEmptyVoxelModel, setVoxel } from "../../types.js";

/**
 * Builds the player Knight voxel model:
 * 8 wide (X), 12 high (Y), 8 deep (Z)
 * Steel plate armor (slate/silver), blue surcoat tabard, steel full-helm with visor slit,
 * iron broadsword on right side and heater shield on left.
 */
export function buildKnightModel(): VoxelModel {
  const palette = [
    "#00000000", // 0: empty
    "#94a3b8", // 1: polished steel plate
    "#64748b", // 2: dark steel / chainmail
    "#334155", // 3: shadowed steel / joints
    "#2563eb", // 4: royal blue surcoat
    "#1d4ed8", // 5: deep blue shield face
    "#0f172a", // 6: visor eye slit
    "#f1f5f9", // 7: gleaming sword blade
    "#d97706", // 8: bronze crossguard / hilt
  ];

  const model = createEmptyVoxelModel("knight", [8, 12, 8], palette);

  // Armored Boots (Y = 0)
  for (let z = 2; z <= 5; z++) {
    setVoxel(model, 2, 0, z, 3);
    setVoxel(model, 5, 0, z, 3);
  }

  // Greaves & Legs (Y = 1 to 2)
  for (let y = 1; y <= 2; y++) {
    for (let z = 2; z <= 5; z++) {
      setVoxel(model, 2, y, z, 2);
      setVoxel(model, 5, y, z, 2);
    }
  }

  // Torso / Steel Breastplate & Surcoat (Y = 3 to 6)
  for (let y = 3; y <= 6; y++) {
    for (let x = 2; x <= 5; x++) {
      for (let z = 2; z <= 5; z++) {
        // Front and back center have royal blue surcoat tabard
        if ((z === 2 || z === 5) && (x === 3 || x === 4)) {
          setVoxel(model, x, y, z, 4);
        } else {
          setVoxel(model, x, y, z, 1);
        }
      }
    }
  }

  // Pauldrons / Shoulder armor (Y = 6, X = 1 and 6)
  for (let z = 2; z <= 5; z++) {
    setVoxel(model, 1, 6, z, 1);
    setVoxel(model, 6, 6, z, 1);
  }

  // Full Helmet (Y = 7 to 10)
  for (let y = 7; y <= 10; y++) {
    for (let x = 2; x <= 5; x++) {
      for (let z = 2; z <= 5; z++) {
        setVoxel(model, x, y, z, 1);
      }
    }
  }

  // Visor Slit (Y = 8, front face Z = 5)
  setVoxel(model, 2, 8, 5, 6);
  setVoxel(model, 3, 8, 5, 6);
  setVoxel(model, 4, 8, 5, 6);
  setVoxel(model, 5, 8, 5, 6);

  // Helmet Crest (Y = 11, top center)
  setVoxel(model, 3, 11, 3, 4);
  setVoxel(model, 4, 11, 3, 4);
  setVoxel(model, 3, 11, 4, 4);
  setVoxel(model, 4, 11, 4, 4);

  // Broadsword in right hand (X = 7, Y = 2 to 9)
  // Bronze hilt & crossguard
  setVoxel(model, 7, 3, 4, 8);
  setVoxel(model, 7, 4, 3, 8);
  setVoxel(model, 7, 4, 4, 8);
  setVoxel(model, 7, 4, 5, 8);
  // Steel Blade
  for (let y = 5; y <= 9; y++) {
    setVoxel(model, 7, y, 4, 7);
  }

  // Heater Shield on left arm (X = 0, Y = 3 to 7, Z = 2 to 5)
  for (let y = 3; y <= 7; y++) {
    for (let z = 2; z <= 5; z++) {
      setVoxel(model, 0, y, z, 5);
    }
  }

  return model;
}
