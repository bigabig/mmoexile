import type { ProjectileShape } from "../components/index.js";

/**
 * Deterministic projectile description shared by client and server.
 * Both sides derive the full trajectory from these values.
 */
export interface ProjectileState {
  id: string;
  ownerId: string;
  isPlayer: boolean;
  startX: number;
  startY: number;
  angle: number;
  speed: number;
  lifetime: number;
  damage: number;
  spawnTime: number;
  color: string;
  radius: number;
  piercing: boolean;
  prefabId?: string;
  shape: ProjectileShape;
}
