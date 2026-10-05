import type { MonsterPrefab } from "../types.js";
import { Enemy } from "../../components/index.js";

export const PiratePrefab: MonsterPrefab = {
  id: "pirate",
  name: "Undead Pirate",
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
      name: "Undead Pirate",
      prefabId: "pirate",
    },
    Model: {
      modelId: "pirate",
      scale: 1.1,
    },
    Minimap: {
      color: "#f59e0b",
      radius: 3,
      shape: "circle",
    },
    Collider: {
      radius: 0.35,
      layer: "enemy",
    },
    Speed: {
      value: 2.4,
    },
    Health: {
      current: 140,
      max: 140,
    },
    CombatStats: {
      defense: 4,
      attack: 14,
      dexterity: 10,
      speed: 2.4,
      xpReward: 35,
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
          name: "Combat",
          movement: {
            type: "chase",
            aggroRadius: 8.0,
            moveSpeed: 2.4,
            standoffDistance: 3.5,
            leashRadius: 14.0,
          },
          attacks: [
            {
              type: "shotgun",
              cooldown: 1.8,
              bulletCount: 3,
              spreadAngle: 0.4,
              damage: 18,
              speed: 7.0,
              lifetime: 1.2,
              color: "#f59e0b",
              radius: 0.3,
              range: 7.5,
              projectilePrefabId: "projectile_square",
            },
          ],
        },
      ],
    },
    DropTable: {
      drops: [
        { itemId: "sword_iron", chance: 0.25 },
        { itemId: "armor_iron", chance: 0.25 },
        { itemId: "staff_fire", chance: 0.15 },
        { itemId: "robe_magician", chance: 0.15 },
      ],
    },
  },
};
