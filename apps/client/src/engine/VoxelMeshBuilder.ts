import * as THREE from "three";
import { VoxelModel, getVoxel, BUILTIN_VOXEL_MODELS } from "@mmoexile/game-core";

interface QuadDef {
  dir: [number, number, number];
  corners: [number, number, number][];
}

// 6 standard cube faces with outward-facing counter-clockwise vertices
const FACES: QuadDef[] = [
  // +X (Right)
  {
    dir: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  // -X (Left)
  {
    dir: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  // +Y (Top)
  {
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  // -Y (Bottom)
  {
    dir: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  // +Z (Front)
  {
    dir: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  // -Z (Back)
  {
    dir: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
];

export class VoxelMeshBuilder {
  private geometryCache = new Map<string, THREE.BufferGeometry>();
  private material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.65,
    metalness: 0.1,
  });

  public getMaterial(): THREE.MeshStandardMaterial {
    return this.material;
  }

  public getOrBuildGeometry(
    modelId: string,
    customModel?: VoxelModel,
    targetHeight: number = 1.2,
  ): THREE.BufferGeometry {
    const cached = this.geometryCache.get(modelId);
    if (cached) return cached;

    const model = customModel || BUILTIN_VOXEL_MODELS[modelId];
    if (!model) {
      console.warn(`Voxel model not found: ${modelId}, falling back to player`);
      return this.getOrBuildGeometry(
        "player",
        BUILTIN_VOXEL_MODELS.player,
        targetHeight,
      );
    }

    const geometry = this.buildCulledGeometry(model, targetHeight);
    this.geometryCache.set(modelId, geometry);
    return geometry;
  }

  public createMesh(
    modelId: string,
    customModel?: VoxelModel,
    targetHeight: number = 1.2,
  ): THREE.Mesh {
    const geom = this.getOrBuildGeometry(modelId, customModel, targetHeight);
    const mesh = new THREE.Mesh(geom, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildCulledGeometry(
    model: VoxelModel,
    targetHeight: number,
  ): THREE.BufferGeometry {
    const [sx, sy, sz] = model.size;
    const voxelScale = targetHeight / sy;

    // Center model horizontally around (0, 0) in X and Z, resting at Y = 0
    const offsetX = -(sx * voxelScale) / 2;
    const offsetZ = -(sz * voxelScale) / 2;

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    // Pre-parse palette hex strings to THREE.Color
    const parsedColors = model.palette.map(
      (hex) => new THREE.Color(hex.slice(0, 7)),
    );

    let vertexOffset = 0;

    for (let z = 0; z < sz; z++) {
      for (let y = 0; y < sy; y++) {
        for (let x = 0; x < sx; x++) {
          const colorIdx = getVoxel(model, x, y, z);
          if (colorIdx === 0) continue; // air

          const color = parsedColors[colorIdx] || parsedColors[1];

          for (const face of FACES) {
            const nx = x + face.dir[0];
            const ny = y + face.dir[1];
            const nz = z + face.dir[2];

            // Neighbor check: if air or out of bounds, this face is exposed
            const neighborColor = getVoxel(model, nx, ny, nz);
            if (neighborColor === 0) {
              const [ndx, ndy, ndz] = face.dir;

              // Add 4 corners of the exposed quad
              for (const [cx, cy, cz] of face.corners) {
                const px = offsetX + (x + cx) * voxelScale;
                const py = (y + cy) * voxelScale;
                const pz = offsetZ + (z + cz) * voxelScale;

                positions.push(px, py, pz);
                normals.push(ndx, ndy, ndz);
                colors.push(color.r, color.g, color.b);
              }

              // 2 triangles per quad
              indices.push(
                vertexOffset,
                vertexOffset + 1,
                vertexOffset + 2,
                vertexOffset,
                vertexOffset + 2,
                vertexOffset + 3,
              );

              vertexOffset += 4;
            }
          }
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }
}
