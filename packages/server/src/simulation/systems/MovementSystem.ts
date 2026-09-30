import { query, hasComponent } from "bitecs";
import {
  Position,
  Velocity,
  Speed,
  Collider,
  InputQueue,
  Player,
  Enemy,
  PortalTag,
  Portal,
  Identity,
  Health,
  resolveCircleTileCollision,
  vec2Dist,
} from "@mmoexile/shared";
import type { ISystem } from "./ISystem.js";
import type { GameWorld } from "../GameWorld.js";

export class MovementSystem implements ISystem {
  public readonly name = "MovementSystem";

  public update(world: GameWorld, dt: number, _now: number): void {
    const ecs = world.ecsWorld;

    // 1. Player Movement & Input Queue Processing
    const players = query(ecs, [Player, Position, Velocity, InputQueue, Speed]);
    for (const eid of players) {
      if (hasComponent(ecs, eid, Health) && Health.current[eid] <= 0) continue;

      const queue = InputQueue.inputs[eid];
      if (!queue || queue.length === 0) {
        Velocity.vx[eid] = 0;
        Velocity.vy[eid] = 0;
        continue;
      }

      // Rate limit: process at most 2 inputs per tick to prevent packet burst / speed hacks
      const MAX_INPUTS_PER_TICK = 2;
      let processed = 0;

      while (queue.length > 0 && processed < MAX_INPUTS_PER_TICK) {
        const input = queue.shift()!;
        processed++;

        InputQueue.lastAckSeq[eid] = input.seq;
        if (Number.isFinite(input.angle)) {
          Position.angle[eid] = input.angle;
        }

        // Validate finite numbers
        const moveX = Number.isFinite(input.moveX) ? input.moveX : 0;
        const moveY = Number.isFinite(input.moveY) ? input.moveY : 0;
        const moveLen = Math.hypot(moveX, moveY);

        if (moveLen > 0) {
          const nx = moveX / moveLen;
          const ny = moveY / moveLen;
          const speed = Math.max(0, Speed.value[eid] || 5.0);

          Velocity.vx[eid] = nx * speed;
          Velocity.vy[eid] = ny * speed;

          // Anti-cheat: Clamp client delta time (max 50ms per input, min 0)
          const clampedDt = Math.min(Math.max(0, Number(input.dt) || 0), 0.05);

          // Disallow movement exceeding speed * clampedDt with tolerance
          const targetDist = speed * clampedDt;
          const radius = Collider.radius[eid] || 0.35;

          // Sub-stepping to prevent wall tunneling if moving > half collider radius
          const numSubSteps = targetDist > radius * 0.5 ? 2 : 1;
          const subStepDist = targetDist / numSubSteps;

          for (let step = 0; step < numSubSteps; step++) {
            const nextX = Position.x[eid] + nx * subStepDist;
            const nextY = Position.y[eid] + ny * subStepDist;

            const resolved = resolveCircleTileCollision(
              { x: nextX, y: nextY },
              radius,
              (tx, ty) => world.isSolid(tx, ty),
            );

            Position.x[eid] = resolved.x;
            Position.y[eid] = resolved.y;
          }
        } else {
          Velocity.vx[eid] = 0;
          Velocity.vy[eid] = 0;
        }
      }

      // Discard stale excess inputs if client is flooding
      if (queue.length > 4) {
        queue.length = 0;
      }
    }

    // 2. Universal Monster Movement & Collision Resolution
    const monsters = query(ecs, [Enemy, Position, Velocity]);
    for (const eid of monsters) {
      if (hasComponent(ecs, eid, Health) && Health.current[eid] <= 0) continue;

      if (Velocity.vx[eid] !== 0 || Velocity.vy[eid] !== 0) {
        const nextX = Position.x[eid] + Velocity.vx[eid] * dt;
        const nextY = Position.y[eid] + Velocity.vy[eid] * dt;
        const radius = Collider.radius[eid] || 0.5;

        const resolved = resolveCircleTileCollision(
          { x: nextX, y: nextY },
          radius,
          (tx, ty) => world.isSolid(tx, ty),
        );

        Position.x[eid] = resolved.x;
        Position.y[eid] = resolved.y;
      }
    }
  }

  public handleInteract(world: GameWorld, playerEid: number): void {
    const ecs = world.ecsWorld;
    if (hasComponent(ecs, playerEid, Health) && Health.current[playerEid] <= 0)
      return;

    const portals = query(ecs, [PortalTag, Position, Portal]);
    const playerPos = { x: Position.x[playerEid], y: Position.y[playerEid] };

    for (const portalEid of portals) {
      const portalPos = { x: Position.x[portalEid], y: Position.y[portalEid] };
      if (vec2Dist(playerPos, portalPos) <= 1.8) {
        world.recordWorldTransfer({
          playerId: Identity.uuid[playerEid],
          targetWorldId: Portal.targetWorldId[portalEid],
        });
        break;
      }
    }
  }
}
