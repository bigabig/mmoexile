import type { MonsterPrefab } from "../types.js";
import { Enemy } from "../../components/index.js";

export const SlimePrefab: MonsterPrefab = {
  id: "slime",
  name: "Forest Slime",
  category: "enemy",
  tags: [Enemy],
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
      name: "Forest Slime",
      prefabId: "slime",
    },
    Model: {
      modelId: "slime",
      scale: 0.8,
    },
    Animation: {
      type: "squash_and_stretch",
    },
    Minimap: {
      color: "#ef4444",
      radius: 2.5,
      shape: "circle",
    },
    Collider: {
      radius: 0.4,
      layer: "enemy",
    },
    Speed: {
      value: 2.0,
    },
    Health: {
      current: 60,
      max: 60,
    },
    CombatStats: {
      defense: 0,
      attack: 10,
      dexterity: 10,
      speed: 2.0,
      xpReward: 15,
    },
    AI: {
      originX: 0,
      originY: 0,
      wanderTimer: 0,
      wanderDir: { x: 0, y: 0 },
      currentPhaseIndex: 0,
      attackTimers: [0],
      phases: [
        {
          name: "Normal",
          movement: {
            type: "chase",
            aggroRadius: 6.0,
            moveSpeed: 2.0,
            standoffDistance: 2.5,
            leashRadius: 12.0,
          },
          attacks: [
            {
              type: "single_shot",
              cooldown: 1.4,
              damage: 15,
              speed: 6.0,
              lifetime: 1.2,
              color: "#22c55e",
              radius: 0.25,
              range: 6.0,
              projectilePrefabId: "projectile_square",
            },
          ],
        },
      ],
    },
    DropTable: {
      drops: [
        { itemId: "staff_energy", chance: 0.35 },
        { itemId: "robe_apprentice", chance: 0.35 },
      ],
    },
  },
};
