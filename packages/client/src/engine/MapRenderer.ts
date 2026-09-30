import * as THREE from "three";
import { MapData, TileType, WallType } from "@mmoexile/shared";

const TILE_COLORS: Record<TileType, THREE.Color> = {
  [TileType.VOID]: new THREE.Color("#090d16"),
  [TileType.WATER]: new THREE.Color("#0284c7"),
  [TileType.SAND]: new THREE.Color("#eab308"),
  [TileType.GRASS]: new THREE.Color("#22c55e"),
  [TileType.DARK_GRASS]: new THREE.Color("#15803d"),
  [TileType.STONE_PATH]: new THREE.Color("#64748b"),
  [TileType.NEXUS_MARBLE]: new THREE.Color("#f1f5f9"),
  [TileType.LAVA]: new THREE.Color("#dc2626"),
};

const WALL_COLORS: Record<
  WallType,
  { main: THREE.Color; top: THREE.Color; height: number }
> = {
  [WallType.NONE]: {
    main: new THREE.Color(0),
    top: new THREE.Color(0),
    height: 0,
  },
  [WallType.STONE_WALL]: {
    main: new THREE.Color("#475569"),
    top: new THREE.Color("#64748b"),
    height: 1.2,
  },
  [WallType.TREE]: {
    main: new THREE.Color("#78350f"), // trunk
    top: new THREE.Color("#166534"), // foliage
    height: 2.2,
  },
  [WallType.WOODEN_WALL]: {
    main: new THREE.Color("#92400e"),
    top: new THREE.Color("#b45309"),
    height: 1.4,
  },
  [WallType.DUNGEON_WALL]: {
    main: new THREE.Color("#1e1b4b"),
    top: new THREE.Color("#312e81"),
    height: 2.0,
  },
  [WallType.MARBLE_PILLAR]: {
    main: new THREE.Color("#e2e8f0"),
    top: new THREE.Color("#fde047"),
    height: 2.4,
  },
};

const CHUNK_SIZE = 32;

export class MapRenderer {
  private scene: THREE.Scene;
  private currentMap: MapData | null = null;
  private chunkMeshes: THREE.Group[] = [];
  private groundMaterial: THREE.MeshStandardMaterial;
  private wallMaterial: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.groundMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0.05,
    });
    this.wallMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      metalness: 0.1,
    });
  }

  public setMap(map: MapData): void {
    this.clear();
    this.currentMap = map;

    const chunksX = Math.ceil(map.width / CHUNK_SIZE);
    const chunksY = Math.ceil(map.height / CHUNK_SIZE);

    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const chunkGroup = this.buildChunk(
          map,
          cx * CHUNK_SIZE,
          cy * CHUNK_SIZE,
        );
        this.chunkMeshes.push(chunkGroup);
        this.scene.add(chunkGroup);
      }
    }
  }

  public clear(): void {
    for (const group of this.chunkMeshes) {
      this.scene.remove(group);
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
        }
      });
    }
    this.chunkMeshes = [];
    this.currentMap = null;
  }

  private buildChunk(
    map: MapData,
    startX: number,
    startY: number,
  ): THREE.Group {
    const group = new THREE.Group();
    const endX = Math.min(startX + CHUNK_SIZE, map.width);
    const endY = Math.min(startY + CHUNK_SIZE, map.height);

    // 1. Build Ground Mesh
    const gPositions: number[] = [];
    const gNormals: number[] = [];
    const gColors: number[] = [];
    const gIndices: number[] = [];
    let gOffset = 0;

    for (let ty = startY; ty < endY; ty++) {
      for (let tx = startX; tx < endX; tx++) {
        const tile = (map.ground[tx + ty * map.width] ??
          TileType.VOID) as TileType;
        const color = TILE_COLORS[tile] || TILE_COLORS[TileType.GRASS];

        // 4 corners of the 1x1 ground tile (Y = 0)
        gPositions.push(
          tx,
          0,
          ty,
          tx + 1,
          0,
          ty,
          tx + 1,
          0,
          ty + 1,
          tx,
          0,
          ty + 1,
        );

        for (let i = 0; i < 4; i++) {
          gNormals.push(0, 1, 0);
          gColors.push(color.r, color.g, color.b);
        }

        gIndices.push(
          gOffset,
          gOffset + 2,
          gOffset + 1,
          gOffset,
          gOffset + 3,
          gOffset + 2,
        );
        gOffset += 4;
      }
    }

    const groundGeom = new THREE.BufferGeometry();
    groundGeom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(gPositions, 3),
    );
    groundGeom.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(gNormals, 3),
    );
    groundGeom.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(gColors, 3),
    );
    groundGeom.setIndex(gIndices);
    groundGeom.computeBoundingBox();

    const groundMesh = new THREE.Mesh(groundGeom, this.groundMaterial);
    groundMesh.receiveShadow = true;
    group.add(groundMesh);

    // 2. Build Walls Mesh (with face culling)
    const wPositions: number[] = [];
    const wNormals: number[] = [];
    const wColors: number[] = [];
    const wIndices: number[] = [];
    let wOffset = 0;

    const isWall = (x: number, y: number) => {
      if (x < 0 || x >= map.width || y < 0 || y >= map.height) return false;
      return (map.walls[x + y * map.width] ?? 0) !== WallType.NONE;
    };

    for (let ty = startY; ty < endY; ty++) {
      for (let tx = startX; tx < endX; tx++) {
        const wall = (map.walls[tx + ty * map.width] ??
          WallType.NONE) as WallType;
        if (wall === WallType.NONE) continue;

        const info = WALL_COLORS[wall] || WALL_COLORS[WallType.STONE_WALL];
        const h = info.height;
        const mainCol = info.main;
        const topCol = info.top;

        // Top Face (always exposed)
        wPositions.push(
          tx,
          h,
          ty,
          tx + 1,
          h,
          ty,
          tx + 1,
          h,
          ty + 1,
          tx,
          h,
          ty + 1,
        );
        for (let i = 0; i < 4; i++) {
          wNormals.push(0, 1, 0);
          wColors.push(topCol.r, topCol.g, topCol.b);
        }
        wIndices.push(
          wOffset,
          wOffset + 2,
          wOffset + 1,
          wOffset,
          wOffset + 3,
          wOffset + 2,
        );
        wOffset += 4;

        // North Face (-Z)
        if (!isWall(tx, ty - 1)) {
          wPositions.push(tx, 0, ty, tx, h, ty, tx + 1, h, ty, tx + 1, 0, ty);
          for (let i = 0; i < 4; i++) {
            wNormals.push(0, 0, -1);
            wColors.push(mainCol.r, mainCol.g, mainCol.b);
          }
          wIndices.push(
            wOffset,
            wOffset + 1,
            wOffset + 2,
            wOffset,
            wOffset + 2,
            wOffset + 3,
          );
          wOffset += 4;
        }

        // South Face (+Z)
        if (!isWall(tx, ty + 1)) {
          wPositions.push(
            tx + 1,
            0,
            ty + 1,
            tx + 1,
            h,
            ty + 1,
            tx,
            h,
            ty + 1,
            tx,
            0,
            ty + 1,
          );
          for (let i = 0; i < 4; i++) {
            wNormals.push(0, 0, 1);
            wColors.push(mainCol.r, mainCol.g, mainCol.b);
          }
          wIndices.push(
            wOffset,
            wOffset + 1,
            wOffset + 2,
            wOffset,
            wOffset + 2,
            wOffset + 3,
          );
          wOffset += 4;
        }

        // West Face (-X)
        if (!isWall(tx - 1, ty)) {
          wPositions.push(tx, 0, ty + 1, tx, h, ty + 1, tx, h, ty, tx, 0, ty);
          for (let i = 0; i < 4; i++) {
            wNormals.push(-1, 0, 0);
            wColors.push(mainCol.r, mainCol.g, mainCol.b);
          }
          wIndices.push(
            wOffset,
            wOffset + 1,
            wOffset + 2,
            wOffset,
            wOffset + 2,
            wOffset + 3,
          );
          wOffset += 4;
        }

        // East Face (+X)
        if (!isWall(tx + 1, ty)) {
          wPositions.push(
            tx + 1,
            0,
            ty,
            tx + 1,
            h,
            ty,
            tx + 1,
            h,
            ty + 1,
            tx + 1,
            0,
            ty + 1,
          );
          for (let i = 0; i < 4; i++) {
            wNormals.push(1, 0, 0);
            wColors.push(mainCol.r, mainCol.g, mainCol.b);
          }
          wIndices.push(
            wOffset,
            wOffset + 1,
            wOffset + 2,
            wOffset,
            wOffset + 2,
            wOffset + 3,
          );
          wOffset += 4;
        }
      }
    }

    if (wPositions.length > 0) {
      const wallGeom = new THREE.BufferGeometry();
      wallGeom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(wPositions, 3),
      );
      wallGeom.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(wNormals, 3),
      );
      wallGeom.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(wColors, 3),
      );
      wallGeom.setIndex(wIndices);
      wallGeom.computeBoundingBox();

      const wallMesh = new THREE.Mesh(wallGeom, this.wallMaterial);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      group.add(wallMesh);
    }

    return group;
  }
}
