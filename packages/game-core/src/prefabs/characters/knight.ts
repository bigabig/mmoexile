import type { CharacterClassPrefab } from "../types.js";
import { Player } from "../../components/index.js";

export const KnightClassPrefab: CharacterClassPrefab = {
  id: "knight",
  name: "Knight",
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
      name: "Knight",
      prefabId: "knight",
    },
    Model: {
      modelId: "knight",
      scale: 1.25,
    },
    Minimap: {
      color: "#94a3b8",
      radius: 4,
      shape: "circle",
    },
    Collider: {
      radius: 0.35,
      layer: "player",
    },
    Speed: {
      value: 4.8,
    },
    Health: {
      current: 150,
      max: 150,
    },
    CombatStats: {
      defense: 4,
      attack: 15,
      dexterity: 8,
      speed: 4.8,
      xpReward: 0,
    },
    Progression: {
      level: 1,
      xp: 0,
      classId: "knight",
      classData: {
        baseStats: {
          maxHp: 150,
          maxMp: 40,
          defense: 4,
          speed: 4.8,
          attack: 15,
          dexterity: 8,
        },
        statGainsPerLevel: {
          maxHp: 25,
          maxMp: 10,
          defense: 1.5,
          speed: 0.04,
          attack: 2.2,
          dexterity: 1.0,
        },
        allowedWeaponSubtypes: ["sword"],
        allowedArmorSubtypes: ["heavy"],
        defaultEquipment: {
          weapon: "sword_iron",
          armor: "armor_iron",
        },
      },
    },
    Equipment: {
      weapon: "sword_iron",
      armor: "armor_iron",
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
