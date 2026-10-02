import { MapData, MapEntityDef, TileType, WallType } from "./types.js";

/**
 * Creates the static 40x40 Nexus Hub map
 */
export function createNexusMap(): MapData {
  const width = 40;
  const height = 40;
  const ground = new Array(width * height).fill(TileType.NEXUS_MARBLE);
  const walls = new Array(width * height).fill(WallType.NONE);

  const setTile = (
    x: number,
    y: number,
    g: TileType,
    w: WallType = WallType.NONE,
  ) => {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      ground[x + y * width] = g;
      walls[x + y * width] = w;
    }
  };

  // Outer border walls
  for (let x = 0; x < width; x++) {
    setTile(x, 0, TileType.VOID, WallType.STONE_WALL);
    setTile(x, height - 1, TileType.VOID, WallType.STONE_WALL);
  }
  for (let y = 0; y < height; y++) {
    setTile(0, y, TileType.VOID, WallType.STONE_WALL);
    setTile(width - 1, y, TileType.VOID, WallType.STONE_WALL);
  }

  // Circular / decorative marble rings
  for (let y = 5; y < 35; y++) {
    for (let x = 5; x < 35; x++) {
      const dx = x - 20;
      const dy = y - 20;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 14 && dist <= 15) {
        setTile(x, y, TileType.STONE_PATH);
      } else if (dist <= 14 && dist > 11) {
        setTile(x, y, TileType.NEXUS_MARBLE);
      } else if (dist <= 11 && dist > 5) {
        setTile(x, y, TileType.STONE_PATH);
      } else if (dist <= 5) {
        setTile(x, y, TileType.NEXUS_MARBLE);
      }
    }
  }

  // Decorative marble pillars
  const pillarPositions = [
    { x: 14, y: 14 },
    { x: 26, y: 14 },
    { x: 14, y: 26 },
    { x: 26, y: 26 },
    { x: 20, y: 12 },
    { x: 20, y: 28 },
    { x: 12, y: 20 },
    { x: 28, y: 20 },
  ];
  for (const p of pillarPositions) {
    setTile(p.x, p.y, TileType.NEXUS_MARBLE, WallType.MARBLE_PILLAR);
  }

  // Entities: Portal to Realm at North of Hub
  const entities: MapEntityDef[] = [
    {
      prefabId: "portal_realm",
      overrides: {
        Position: { x: 20, y: 9, angle: 0 },
        Identity: {
          uuid: "portal_to_overworld",
          name: "Realm of the Ancients",
        },
        Portal: {
          targetZoneId: "overworld",
          name: "Realm of the Ancients",
          kind: "realm",
        },
      },
    },
  ];

  return {
    id: "nexus",
    name: "Nexus Hub",
    width,
    height,
    spawnPoint: { x: 20, y: 20 },
    ground,
    walls,
    entities,
  };
}
