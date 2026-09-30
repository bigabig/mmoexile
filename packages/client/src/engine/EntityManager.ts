import * as THREE from "three";
import {
  EntityState,
  getPrefab,
  Animation,
  type ComponentValue,
  type ProceduralAnimationType,
} from "@mmoexile/shared";
import { VoxelMeshBuilder } from "./VoxelMeshBuilder.js";

interface RenderedEntity {
  state: EntityState;
  targetPos: THREE.Vector3;
  currentPos: THREE.Vector3;
  targetAngle: number;
  currentAngle: number;
  rootGroup: THREE.Group;
  voxelMesh: THREE.Mesh;
  hpBarMesh?: THREE.Mesh;
  hpBarBgMesh?: THREE.Mesh;
}

export class EntityManager {
  private scene: THREE.Scene;
  private voxelBuilder: VoxelMeshBuilder;
  private entities = new Map<string, RenderedEntity>();
  public localPlayerId: string | null = null;

  constructor(scene: THREE.Scene, voxelBuilder: VoxelMeshBuilder) {
    this.scene = scene;
    this.voxelBuilder = voxelBuilder;
  }

  public updateFromSnapshot(snapshotEntities: EntityState[]): void {
    const presentIds = new Set<string>();

    for (const state of snapshotEntities) {
      presentIds.add(state.id);

      let entity = this.entities.get(state.id);
      if (!entity) {
        entity = this.createRenderedEntity(state);
        this.entities.set(state.id, entity);
      }

      entity.state = state;

      // Update target position for remote entities (for local player, NetworkManager handles reconciliation)
      if (state.id !== this.localPlayerId) {
        entity.targetPos.set(state.x, 0, state.y);
        entity.targetAngle = state.angle;
      }

      // Update HP bar
      this.updateHpBar(entity);
    }

    // Remove entities no longer in snapshot
    for (const [id, entity] of this.entities) {
      if (!presentIds.has(id)) {
        this.scene.remove(entity.rootGroup);
        this.entities.delete(id);
      }
    }
  }

  public setLocalPlayerPosition(x: number, y: number, angle: number): void {
    if (!this.localPlayerId) return;
    const entity = this.entities.get(this.localPlayerId);
    if (entity) {
      entity.currentPos.set(x, 0, y);
      entity.targetPos.set(x, 0, y);
      entity.currentAngle = angle;
      entity.rootGroup.position.set(x, 0, y);
      entity.voxelMesh.rotation.y = -angle + Math.PI / 2;
    }
  }

  public getEntity(id: string): RenderedEntity | undefined {
    return this.entities.get(id);
  }

  public getAllEntities(): EntityState[] {
    return Array.from(this.entities.values()).map((e) => e.state);
  }

  public update(dt: number, time: number): void {
    for (const [id, entity] of this.entities) {
      // Remote entities smooth interpolation
      if (id !== this.localPlayerId) {
        entity.currentPos.lerp(entity.targetPos, Math.min(1.0, dt * 15));
        entity.rootGroup.position.copy(entity.currentPos);

        // Smooth angle rotation
        entity.currentAngle +=
          (entity.targetAngle - entity.currentAngle) * Math.min(1.0, dt * 10);
        entity.voxelMesh.rotation.y = -entity.currentAngle + Math.PI / 2;
      }

      // Universal procedural animation driven by entity prefab's Animation component
      const prefab =
        getPrefab(entity.state.subtype) ??
        (entity.state.modelId ? getPrefab(entity.state.modelId) : undefined) ??
        getPrefab(entity.state.type);
      if (prefab?.components.Animation?.type) {
        this.applyProceduralAnimation(
          entity.voxelMesh,
          prefab.components.Animation,
          time,
          entity.state.x,
        );
      }
    }
  }

  private applyProceduralAnimation(
    mesh: THREE.Mesh,
    anim: ComponentValue<typeof Animation> | ProceduralAnimationType,
    time: number,
    seedX: number = 0,
  ): void {
    const type = typeof anim === "string" ? anim : anim.type;
    const speed =
      typeof anim === "object" && anim.speed != null ? anim.speed : 1.0;
    const amplitude =
      typeof anim === "object" && anim.amplitude != null
        ? anim.amplitude
        : 0.15;

    switch (type) {
      case "float":
        mesh.position.y = 0.2 + Math.sin(time * speed + seedX) * amplitude;
        break;
      case "bob":
        mesh.position.y = Math.sin(time * speed + seedX) * amplitude;
        break;
      case "squash_and_stretch":
        mesh.scale.y = 1.0 + Math.sin(time * 6 * speed) * amplitude;
        break;
      case "spin":
        mesh.rotation.y += 0.05 * speed;
        break;
      case "none":
      default:
        break;
    }
  }

  private createRenderedEntity(state: EntityState): RenderedEntity {
    const rootGroup = new THREE.Group();
    rootGroup.position.set(state.x, 0, state.y);

    const prefab =
      getPrefab(state.subtype) ??
      (state.modelId ? getPrefab(state.modelId) : undefined) ??
      getPrefab(state.type);
    const targetHeight =
      prefab?.components.Model?.scale ??
      (state.type === "portal" ? 1.8 : state.type === "loot_bag" ? 0.6 : 1.2);

    const voxelMesh = this.voxelBuilder.createMesh(
      prefab?.components.Model?.modelId || state.modelId || "player",
      undefined,
      targetHeight,
    );
    rootGroup.add(voxelMesh);

    // Create floating mini health bar for monsters & other players
    let hpBarMesh: THREE.Mesh | undefined;
    let hpBarBgMesh: THREE.Mesh | undefined;

    if (state.type === "monster" || state.type === "player") {
      const barY = targetHeight + 0.35;
      const bgGeom = new THREE.PlaneGeometry(1.0, 0.12);
      const bgMat = new THREE.MeshBasicMaterial({
        color: 0x1e293b,
        side: THREE.DoubleSide,
      });
      hpBarBgMesh = new THREE.Mesh(bgGeom, bgMat);
      hpBarBgMesh.position.set(0, barY, 0);

      const fgGeom = new THREE.PlaneGeometry(0.96, 0.08);
      const fgMat = new THREE.MeshBasicMaterial({
        color: state.type === "monster" ? 0xef4444 : 0x22c55e,
        side: THREE.DoubleSide,
      });
      hpBarMesh = new THREE.Mesh(fgGeom, fgMat);
      hpBarMesh.position.set(0, barY, 0.01);

      rootGroup.add(hpBarBgMesh);
      rootGroup.add(hpBarMesh);
    }

    this.scene.add(rootGroup);

    return {
      state,
      targetPos: new THREE.Vector3(state.x, 0, state.y),
      currentPos: new THREE.Vector3(state.x, 0, state.y),
      targetAngle: state.angle,
      currentAngle: state.angle,
      rootGroup,
      voxelMesh,
      hpBarMesh,
      hpBarBgMesh,
    };
  }

  private updateHpBar(entity: RenderedEntity): void {
    if (!entity.hpBarMesh) return;
    const ratio = Math.max(
      0,
      Math.min(1, entity.state.hp / entity.state.maxHp),
    );
    entity.hpBarMesh.scale.x = ratio;
    entity.hpBarMesh.position.x = -(1 - ratio) * 0.48;
  }

  public clear(): void {
    for (const entity of this.entities.values()) {
      this.scene.remove(entity.rootGroup);
    }
    this.entities.clear();
  }
}
