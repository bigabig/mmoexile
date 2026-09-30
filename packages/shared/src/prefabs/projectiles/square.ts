import type { ProjectilePrefab } from "../types.js";
import { ProjectileTag } from "../../components/index.js";

export const SquareProjectilePrefab: ProjectilePrefab = {
  id: "projectile_square",
  name: "Square Energy Bolt",
  category: "projectile",
  tags: [ProjectileTag],
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
      name: "Square Energy Bolt",
      prefabId: "projectile_square",
    },
    Model: {
      modelId: "projectile_square",
      scale: 0.35,
      tint: "#38bdf8",
    },
    Animation: {
      type: "spin",
    },
    Collider: {
      radius: 0.3,
      layer: "projectile",
      isTrigger: true,
    },
    Projectile: {
      shape: "square",
      speed: 11.0,
      lifetime: 0.9,
      damage: 20,
      color: "#38bdf8",
      piercing: false,
      startX: 0,
      startY: 0,
      spawnTime: 0,
      isPlayer: false,
      ownerEid: 0,
      prefabId: "projectile_square",
    },
  },
};
