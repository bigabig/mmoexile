import { query, hasComponent } from "bitecs";
import { Vec2, vec2DistSq, Position, Collider, Health } from "@mmoexile/shared";
import type { ISystem } from "./ISystem.js";
import type { GameWorld } from "../GameWorld.js";

export class SpatialSystem implements ISystem {
  public readonly name = "SpatialSystem";
  private cellSize: number;
  private cells: Map<number, Set<number>> = new Map();
  private entityCellMap: Map<number, number> = new Map();

  constructor(cellSize: number = 4) {
    this.cellSize = cellSize;
  }

  private getKey(x: number, y: number): number {
    const cx = Math.floor(x / this.cellSize) + 32768;
    const cy = Math.floor(y / this.cellSize) + 32768;
    return (cx << 16) | (cy & 0xffff);
  }

  public insert(eid: number, x: number, y: number): void {
    const key = this.getKey(x, y);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Set();
      this.cells.set(key, cell);
    }
    cell.add(eid);
    this.entityCellMap.set(eid, key);
  }

  public remove(eid: number): void {
    const key = this.entityCellMap.get(eid);
    if (key === undefined) return;
    const cell = this.cells.get(key);
    if (cell) {
      cell.delete(eid);
      if (cell.size === 0) {
        this.cells.delete(key);
      }
    }
    this.entityCellMap.delete(eid);
  }

  public updateEntity(eid: number, x: number, y: number): void {
    const oldKey = this.entityCellMap.get(eid);
    const newKey = this.getKey(x, y);

    if (oldKey === newKey) return;

    this.remove(eid);
    this.insert(eid, x, y);
  }

  /**
   * Queries all entities within radius of a point, optionally filtered by collision layer.
   */
  public queryRadius(
    world: GameWorld,
    center: Vec2,
    radius: number,
    layerFilter?:
      | "player"
      | "enemy"
      | "projectile"
      | "item"
      | "portal"
      | "neutral",
  ): number[] {
    const minCx = Math.floor((center.x - radius) / this.cellSize);
    const maxCx = Math.floor((center.x + radius) / this.cellSize);
    const minCy = Math.floor((center.y - radius) / this.cellSize);
    const maxCy = Math.floor((center.y + radius) / this.cellSize);

    const results: number[] = [];
    const checked = new Set<number>();

    for (let cx = minCx; cx <= maxCx; cx++) {
      const cxPart = (cx + 32768) << 16;
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = cxPart | ((cy + 32768) & 0xffff);
        const cell = this.cells.get(key);
        if (!cell) continue;

        for (const eid of cell) {
          if (checked.has(eid)) continue;
          checked.add(eid);

          if (
            hasComponent(world.ecsWorld, eid, Health) &&
            Health.current[eid] <= 0
          ) {
            continue;
          }

          if (layerFilter && Collider.layer[eid] !== layerFilter) {
            continue;
          }

          const entityRadius = Collider.radius[eid] || 0.4;
          const totalRadius = radius + entityRadius;
          const distSq = vec2DistSq(center, {
            x: Position.x[eid],
            y: Position.y[eid],
          });

          if (distSq <= totalRadius * totalRadius) {
            results.push(eid);
          }
        }
      }
    }

    return results;
  }

  public update(world: GameWorld, _dt: number, _now: number): void {
    const collidables = query(world.ecsWorld, [Position, Collider]);
    const currentEids = new Set<number>();

    for (const eid of collidables) {
      if (
        hasComponent(world.ecsWorld, eid, Health) &&
        Health.current[eid] <= 0
      ) {
        this.remove(eid);
        continue;
      }
      currentEids.add(eid);
      this.updateEntity(eid, Position.x[eid], Position.y[eid]);
    }

    // Clean up any untracked entities
    for (const eid of this.entityCellMap.keys()) {
      if (!currentEids.has(eid)) {
        this.remove(eid);
      }
    }
  }

  public clear(): void {
    this.cells.clear();
    this.entityCellMap.clear();
  }
}
