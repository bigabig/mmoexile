import * as THREE from "three";
import { ProjectileState } from "@mmoexile/game-core";

interface ActiveBullet {
  state: ProjectileState;
  mesh: THREE.Mesh;
  isRectangular: boolean;
}

export class ProjectileRenderer {
  private scene: THREE.Scene;
  private bullets: Map<string, ActiveBullet> = new Map();
  private squareGeom = new THREE.BoxGeometry(0.35, 0.35, 0.35);
  private rectangularGeom = new THREE.BoxGeometry(0.2, 0.2, 0.65);
  private materials = new Map<string, THREE.MeshBasicMaterial>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private getMaterial(colorHex: string): THREE.MeshBasicMaterial {
    let mat = this.materials.get(colorHex);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colorHex) });
      this.materials.set(colorHex, mat);
    }
    return mat;
  }

  public spawnBullet(state: ProjectileState): void {
    if (this.bullets.has(state.id)) return;

    const isRectangular =
      state.shape === "rectangular" ||
      state.prefabId === "projectile_rectangular";
    const geom = isRectangular ? this.rectangularGeom : this.squareGeom;
    const mat = this.getMaterial(state.color || "#38bdf8");
    const mesh = new THREE.Mesh(geom, mat);

    // Initial position & orientation
    mesh.position.set(state.startX, 0.5, state.startY);
    mesh.rotation.y = -state.angle; // Align with trajectory

    this.scene.add(mesh);
    this.bullets.set(state.id, { state, mesh, isRectangular });
  }

  public removeBullet(bulletId: string): void {
    const b = this.bullets.get(bulletId);
    if (b) {
      this.scene.remove(b.mesh);
      this.bullets.delete(bulletId);
    }
  }

  public update(now: number): void {
    for (const [id, b] of this.bullets) {
      const age = (now - b.state.spawnTime) / 1000;

      if (age >= b.state.lifetime) {
        this.scene.remove(b.mesh);
        this.bullets.delete(id);
        continue;
      }

      const curX =
        b.state.startX + Math.cos(b.state.angle) * b.state.speed * age;
      const curZ =
        b.state.startY + Math.sin(b.state.angle) * b.state.speed * age;

      b.mesh.position.set(curX, 0.5, curZ);

      if (b.isRectangular) {
        // Keep pointing in flight direction, roll along flight axis
        b.mesh.rotation.y = -b.state.angle;
        b.mesh.rotation.z += 0.08;
      } else {
        // Tumble square energy cube
        b.mesh.rotation.x += 0.1;
        b.mesh.rotation.z += 0.1;
      }
    }
  }

  public clear(): void {
    for (const b of this.bullets.values()) {
      this.scene.remove(b.mesh);
    }
    this.bullets.clear();
  }
}
