import type { MonsterPrefab } from "../types.js";
import { Enemy } from "../../components/index.js";

export const GolemBossPrefab: MonsterPrefab = {
  id: "golem_boss",
  name: "Ancient Stone Golem",
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
      name: "Ancient Stone Golem",
      prefabId: "golem_boss",
    },
    Model: {
      modelId: "golem_boss",
      scale: 2.4,
    },
    Minimap: {
      color: "#dc2626",
      radius: 6,
      shape: "diamond",
    },
    Collider: {
      radius: 0.8,
      layer: "enemy",
    },
    Speed: {
      value: 1.6,
    },
    Health: {
      current: 1200,
      max: 1200,
    },
    CombatStats: {
      defense: 12,
      attack: 25,
      dexterity: 8,
      speed: 1.6,
      xpReward: 300,
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
          name: "Guarding",
          movement: {
            type: "stand",
            trackPlayer: true,
          },
          attacks: [
            {
              type: "shotgun",
              cooldown: 2.0,
              bulletCount: 5,
              spreadAngle: 0.5,
              damage: 28,
              speed: 8.0,
              lifetime: 1.4,
              color: "#ef4444",
              radius: 0.35,
              range: 12.0,
              projectilePrefabId: "projectile_square",
            },
          ],
        },
        {
          name: "Enraged",
          triggerOnHpPercent: 0.5,
          speedMultiplier: 1.8,
          movement: {
            type: "chase",
            aggroRadius: 14.0,
            moveSpeed: 2.4,
            standoffDistance: 1.0,
            leashRadius: 20.0,
          },
          attacks: [
            {
              type: "shotgun",
              cooldown: 1.2,
              bulletCount: 5,
              spreadAngle: 0.6,
              damage: 32,
              speed: 9.5,
              lifetime: 1.4,
              color: "#f97316",
              radius: 0.35,
              range: 12.0,
              projectilePrefabId: "projectile_square",
            },
            {
              type: "radial_nova",
              cooldown: 3.5,
              bulletCount: 16,
              damage: 25,
              speed: 6.5,
              lifetime: 2.0,
              color: "#dc2626",
              radius: 0.3,
              range: 12.0,
              projectilePrefabId: "projectile_square",
            },
          ],
        },
      ],
    },
    DropTable: {
      drops: [
        { itemId: "staff_fire", chance: 0.5 },
        { itemId: "robe_magician", chance: 0.5 },
        { itemId: "sword_iron", chance: 0.5 },
        { itemId: "armor_iron", chance: 0.5 },
      ],
    },
  },
};
