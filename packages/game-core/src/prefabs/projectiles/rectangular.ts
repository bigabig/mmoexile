import type { ProjectilePrefab } from "../types.js";
import { ProjectileTag } from "../../components/index.js";

export const RectangularProjectilePrefab: ProjectilePrefab = {
  id: "projectile_rectangular",
  name: "Rectangular Energy Bolt",
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
      name: "Rectangular Energy Bolt",
      prefabId: "projectile_rectangular",
    },
    Model: {
      modelId: "projectile_rectangular",
      scale: 0.35,
      tint: "#f59e0b",
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
      shape: "rectangular",
      speed: 14.0,
      lifetime: 0.8,
      damage: 25,
      color: "#f59e0b",
      piercing: false,
      startX: 0,
      startY: 0,
      spawnTime: 0,
      isPlayer: false,
      ownerEid: 0,
      prefabId: "projectile_rectangular",
    },
  },
};
