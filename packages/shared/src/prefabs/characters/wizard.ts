import type { CharacterClassPrefab } from "../types.js";
import { Player } from "../../components/index.js";

export const WizardClassPrefab: CharacterClassPrefab = {
  id: "wizard",
  name: "Wizard",
  category: "character",
  tags: [Player],
  components: {
    Position: {
      x: 0,
      y: 0,
      angle: 0,
    },
    Velocity: {
      vx: 0,
      vy: 0,
    },
    Identity: {
      name: "Wizard",
      prefabId: "wizard",
    },
    Model: {
      modelId: "player",
      scale: 1.2,
    },
    Minimap: {
      color: "#38bdf8",
      radius: 4,
      shape: "circle",
    },
    Collider: {
      radius: 0.35,
      layer: "player",
    },
    Speed: {
      value: 5.5,
    },
    Health: {
      current: 100,
      max: 100,
    },
    CombatStats: {
      defense: 0,
      attack: 12,
      dexterity: 10,
      speed: 5.5,
      xpReward: 0,
    },
    Progression: {
      level: 1,
      xp: 0,
      classId: "wizard",
      classData: {
        baseStats: {
          maxHp: 100,
          maxMp: 80,
          defense: 0,
          speed: 5.5,
          attack: 12,
          dexterity: 10,
        },
        statGainsPerLevel: {
          maxHp: 18,
          maxMp: 25,
          defense: 0.5,
          speed: 0.05,
          attack: 2.0,
          dexterity: 1.5,
        },
        allowedWeaponSubtypes: ["staff"],
        allowedArmorSubtypes: ["robe"],
        defaultEquipment: {
          weapon: "staff_energy",
          armor: "robe_apprentice",
        },
      },
    },
    Equipment: {
      weapon: "staff_energy",
      armor: "robe_apprentice",
    },
    Inventory: {
      slots: new Array(8).fill(null),
    },
    InputQueue: {
      inputs: [],
      lastAckSeq: 0,
    },
    Shooter: {
      cooldownTimer: 0,
    },
  },
};
