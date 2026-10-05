export enum TileType {
  VOID = 0,
  WATER = 1,
  SAND = 2,
  GRASS = 3,
  DARK_GRASS = 4,
  STONE_PATH = 5,
  NEXUS_MARBLE = 6,
  LAVA = 7,
}

export enum WallType {
  NONE = 0,
  STONE_WALL = 10,
  TREE = 11,
  WOODEN_WALL = 12,
  DUNGEON_WALL = 13,
  MARBLE_PILLAR = 14,
}

export interface MapGeometry {
  width: number;
  height: number;
  ground: number[]; // size: width * height
  walls: number[]; // size: width * height (0 = none, >0 = WallType)
}

export function isSolidTile(map: MapGeometry, tx: number, ty: number): boolean {
  if (tx < 0 || tx >= map.width || ty < 0 || ty >= map.height) return true;
  const idx = tx + ty * map.width;
  const wall = map.walls[idx];
  if (wall !== WallType.NONE && wall !== undefined) return true;
  const ground = map.ground[idx];
  if (ground === TileType.VOID) return true;
  return false;
}
