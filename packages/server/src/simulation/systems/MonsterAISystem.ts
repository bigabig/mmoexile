import { query, addComponent } from "bitecs";
import {
  Enemy,
  Player,
  Position,
  Velocity,
  Speed,
  AI,
  Health,
  CombatStats,
  Targeting,
  vec2Dist,
  type MonsterAttackConfig,
} from "@rotmg/shared";
import type { ISystem } from "./ISystem.js";
import type { GameWorld } from "../GameWorld.js";

export class MonsterAISystem implements ISystem {
  public readonly name = "MonsterAISystem";

  public evaluatePhase(_world: GameWorld, eid: number): void {
    const phases = AI.phases[eid];
    if (!phases || phases.length === 0) return;

    const hpPct = Health.current[eid] / Health.max[eid];
    let targetPhaseIdx = 0;
    for (let i = phases.length - 1; i >= 0; i--) {
      const phase = phases[i];
      if (
        phase.triggerOnHpPercent !== undefined &&
        hpPct <= phase.triggerOnHpPercent
      ) {
        targetPhaseIdx = i;
        break;
      }
    }

    if (targetPhaseIdx !== AI.currentPhaseIndex[eid]) {
      AI.currentPhaseIndex[eid] = targetPhaseIdx;
      const newPhase = phases[targetPhaseIdx];
      AI.attackTimers[eid] = newPhase.attacks?.map(() => 0) ?? [];
    }
  }

  public update(world: GameWorld, dt: number, now: number): void {
    const ecs = world.ecsWorld;
    const alivePlayerEids: number[] = [];
    const allPlayers = query(ecs, [Player, Position, Health]);

    for (const pEid of allPlayers) {
      if (Health.current[pEid] > 0) {
        alivePlayerEids.push(pEid);
      }
    }

    const monsters = query(ecs, [
      Enemy,
      Position,
      Velocity,
      AI,
      Health,
      CombatStats,
    ]);

    for (const mEid of monsters) {
      if (Health.current[mEid] <= 0) continue;

      // Evaluate phase transitions based on HP
      this.evaluatePhase(world, mEid);

      const currentPhase = AI.phases[mEid]?.[
        AI.currentPhaseIndex[mEid] ?? 0
      ] ?? {
        name: "Default",
        movement: { type: "idle" },
      };

      const speedMultiplier = currentPhase.speedMultiplier ?? 1.0;
      const patternSpeed =
        currentPhase.movement && "moveSpeed" in currentPhase.movement
          ? currentPhase.movement.moveSpeed
          : undefined;
      const baseSpeed = Speed.value[mEid] || CombatStats.speed[mEid] || 3.0;
      const moveSpeed = (patternSpeed ?? baseSpeed) * speedMultiplier;

      const monsterX = Position.x[mEid];
      const monsterY = Position.y[mEid];

      // --- Movement Intent ---
      const mov = currentPhase.movement ?? { type: "idle" };
      let targetPlayerEid: number | null = null;
      let targetDist = Infinity;

      if (mov.type === "chase") {
        for (const pEid of alivePlayerEids) {
          const d = vec2Dist(
            { x: monsterX, y: monsterY },
            { x: Position.x[pEid], y: Position.y[pEid] },
          );
          if (d < targetDist) {
            targetDist = d;
            targetPlayerEid = pEid;
          }
        }

        const aggroRadius = mov.aggroRadius ?? 8.0;
        const standoff = mov.standoffDistance ?? 0.5;

        if (targetPlayerEid !== null && targetDist <= aggroRadius) {
          addComponent(ecs, mEid, Targeting(targetPlayerEid));
          const pX = Position.x[targetPlayerEid];
          const pY = Position.y[targetPlayerEid];
          const dx = pX - monsterX;
          const dy = pY - monsterY;
          Position.angle[mEid] = Math.atan2(dy, dx);

          if (targetDist > standoff) {
            Velocity.vx[mEid] = (dx / targetDist) * moveSpeed;
            Velocity.vy[mEid] = (dy / targetDist) * moveSpeed;
          } else {
            Velocity.vx[mEid] = 0;
            Velocity.vy[mEid] = 0;
          }
        } else {
          // Check leash back to spawn origin
          const leashRadius = mov.leashRadius ?? 16.0;
          const originX = AI.originX[mEid];
          const originY = AI.originY[mEid];
          const distToOrigin = vec2Dist(
            { x: monsterX, y: monsterY },
            { x: originX, y: originY },
          );

          if (distToOrigin > leashRadius || distToOrigin > 1.0) {
            const dx = originX - monsterX;
            const dy = originY - monsterY;
            const dist = Math.hypot(dx, dy);
            Position.angle[mEid] = Math.atan2(dy, dx);
            Velocity.vx[mEid] = (dx / dist) * moveSpeed;
            Velocity.vy[mEid] = (dy / dist) * moveSpeed;
          } else {
            Velocity.vx[mEid] = 0;
            Velocity.vy[mEid] = 0;
          }
        }
      } else if (mov.type === "stand") {
        Velocity.vx[mEid] = 0;
        Velocity.vy[mEid] = 0;
        if (mov.trackPlayer) {
          for (const pEid of alivePlayerEids) {
            const d = vec2Dist(
              { x: monsterX, y: monsterY },
              { x: Position.x[pEid], y: Position.y[pEid] },
            );
            if (d < targetDist) {
              targetDist = d;
              targetPlayerEid = pEid;
            }
          }
          if (targetPlayerEid !== null) {
            const dx = Position.x[targetPlayerEid] - monsterX;
            const dy = Position.y[targetPlayerEid] - monsterY;
            Position.angle[mEid] = Math.atan2(dy, dx);
          }
        }
      } else {
        // Idle / Wander
        AI.wanderTimer[mEid] = (AI.wanderTimer[mEid] || 0) - dt;
        if (AI.wanderTimer[mEid] <= 0) {
          AI.wanderTimer[mEid] = 2.0 + Math.random() * 2.0;
          const wanderAngle = Math.random() * Math.PI * 2;
          AI.wanderDir[mEid] = {
            x: Math.cos(wanderAngle),
            y: Math.sin(wanderAngle),
          };
        }

        const originX = AI.originX[mEid];
        const originY = AI.originY[mEid];
        const wanderRadius =
          "wanderRadius" in mov ? ((mov as any).wanderRadius ?? 4.0) : 4.0;
        const distFromOrigin = vec2Dist(
          { x: monsterX, y: monsterY },
          { x: originX, y: originY },
        );

        if (distFromOrigin > wanderRadius) {
          const dx = originX - monsterX;
          const dy = originY - monsterY;
          const dist = Math.hypot(dx, dy);
          Velocity.vx[mEid] = (dx / dist) * moveSpeed * 0.5;
          Velocity.vy[mEid] = (dy / dist) * moveSpeed * 0.5;
        } else {
          const dir = AI.wanderDir[mEid] || { x: 0, y: 0 };
          Velocity.vx[mEid] = dir.x * moveSpeed * 0.5;
          Velocity.vy[mEid] = dir.y * moveSpeed * 0.5;
        }
      }

      // --- Attack Execution ---
      const attacks = currentPhase.attacks;
      if (!attacks || attacks.length === 0) continue;

      if (!AI.attackTimers[mEid]) {
        AI.attackTimers[mEid] = attacks.map(() => 0);
      }

      // Find closest player for attack targeting if not already computed
      if (targetPlayerEid === null) {
        for (const pEid of alivePlayerEids) {
          const d = vec2Dist(
            { x: monsterX, y: monsterY },
            { x: Position.x[pEid], y: Position.y[pEid] },
          );
          if (d < targetDist) {
            targetDist = d;
            targetPlayerEid = pEid;
          }
        }
      }

      for (let i = 0; i < attacks.length; i++) {
        const attack = attacks[i];
        AI.attackTimers[mEid][i] = (AI.attackTimers[mEid][i] || 0) - dt;

        if (AI.attackTimers[mEid][i] <= 0) {
          const attackRange = attack.range ?? 9.0;
          if (targetPlayerEid !== null && targetDist <= attackRange) {
            const pX = Position.x[targetPlayerEid];
            const pY = Position.y[targetPlayerEid];
            const aimAngle = Math.atan2(pY - monsterY, pX - monsterX);

            this.executeAttack(world, mEid, attack, aimAngle, now);
            AI.attackTimers[mEid][i] =
              attack.cooldown ?? attack.shootCooldown ?? 1.5;
          }
        }
      }
    }
  }

  private executeAttack(
    world: GameWorld,
    monsterEid: number,
    attack: MonsterAttackConfig,
    aimAngle: number,
    now: number,
  ): void {
    const startX = Position.x[monsterEid];
    const startY = Position.y[monsterEid];
    const speed = attack.speed ?? 8.0;
    const lifetime = attack.lifetime ?? 1.5;
    const damage = attack.damage ?? 15;
    const color = attack.color ?? "#ff4444";
    const radius = attack.radius ?? 0.3;
    const prefabId =
      attack.projectilePrefabId ?? attack.bulletPrefab ?? "projectile_square";

    if (attack.type === "single_shot" || !attack.type) {
      world.spawnProjectile({
        ownerEid: monsterEid,
        isPlayer: false,
        startX,
        startY,
        angle: aimAngle,
        speed,
        lifetime,
        damage,
        color,
        radius,
        spawnTime: now,
        prefabId,
      });
    } else if (attack.type === "shotgun") {
      const count = attack.bulletCount ?? attack.spreadCount ?? 3;
      const spread = attack.spreadAngle ?? 0.4;
      const startAngle = aimAngle - spread / 2;
      const step = count > 1 ? spread / (count - 1) : 0;

      for (let b = 0; b < count; b++) {
        const angle = count === 1 ? aimAngle : startAngle + step * b;
        world.spawnProjectile({
          ownerEid: monsterEid,
          isPlayer: false,
          startX,
          startY,
          angle,
          speed,
          lifetime,
          damage,
          color,
          radius,
          spawnTime: now,
          prefabId,
        });
      }
    } else if (attack.type === "radial_nova") {
      const count = attack.bulletCount ?? 16;
      const step = (Math.PI * 2) / count;

      for (let b = 0; b < count; b++) {
        const angle = step * b;
        world.spawnProjectile({
          ownerEid: monsterEid,
          isPlayer: false,
          startX,
          startY,
          angle,
          speed,
          lifetime,
          damage,
          color,
          radius,
          spawnTime: now,
          prefabId,
        });
      }
    }
  }
}
