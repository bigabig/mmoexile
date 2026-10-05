import { MapData, MapEntityDef, TileType, WallType } from "./types.js";

/**
 * Creates the static 64x64 Realm Overworld map
 */
export function createOverworldMap(): MapData {
  const width = 64;
  const height = 64;
  const ground = new Array(width * height).fill(TileType.GRASS);
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

  // Outer ocean border
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isEdge = x <= 2 || x >= width - 3 || y <= 2 || y >= height - 3;
      const isBeach = x <= 5 || x >= width - 6 || y <= 5 || y >= height - 6;
      if (isEdge) {
        setTile(x, y, TileType.VOID, WallType.STONE_WALL);
      } else if (isBeach) {
        setTile(x, y, TileType.SAND);
      }
    }
  }

  // Forest clusters (Dark grass and trees)
  const forestZones = [
    { cx: 18, cy: 22, r: 8 },
    { cx: 46, cy: 24, r: 9 },
    { cx: 32, cy: 38, r: 7 },
  ];

  for (const f of forestZones) {
    for (let y = f.cy - f.r; y <= f.cy + f.r; y++) {
      for (let x = f.cx - f.r; x <= f.cx + f.r; x++) {
        const d = Math.sqrt((x - f.cx) ** 2 + (y - f.cy) ** 2);
        if (d <= f.r) {
          setTile(x, y, TileType.DARK_GRASS);
          if (d <= f.r - 2 && (x * 7 + y * 13) % 4 === 0) {
            setTile(x, y, TileType.DARK_GRASS, WallType.TREE);
          }
        }
      }
    }
  }

  // Pirate / Bandit camp in the northwest
  for (let y = 10; y <= 20; y++) {
    for (let x = 36; x <= 48; x++) {
      setTile(x, y, TileType.STONE_PATH);
      if (x === 36 || x === 48 || y === 10 || y === 20) {
        if (x !== 42 && y !== 15) {
          setTile(x, y, TileType.STONE_PATH, WallType.WOODEN_WALL);
        }
      }
    }
  }

  // Entities: Portals & Spawners
  const entities: MapEntityDef[] = [
    // Nexus portal at South beach spawn
    {
      prefabId: "portal_nexus",
      overrides: {
        Position: { x: 32, y: 56, angle: 0 },
        Identity: {
          uuid: "portal_to_nexus",
          name: "Nexus Portal",
        },
        Portal: {
          targetZoneId: "nexus",
          name: "Nexus Portal",
          kind: "nexus",
        },
      },
    },
    // Golem Dungeon portal in pirate camp
    {
      prefabId: "portal_golem_dungeon",
      overrides: {
        Position: { x: 42, y: 15, angle: 0 },
        Identity: {
          uuid: "portal_to_dungeon_1",
          name: "Golem Lair Dungeon",
        },
        Portal: {
          targetZoneId: "golem_dungeon",
          name: "Golem Lair Dungeon",
          kind: "dungeon",
        },
      },
    },
    // Enemy spawners
    {
      prefabId: "spawner",
      overrides: {
        Position: { x: 24, y: 32, angle: 0 },
        Identity: {
          uuid: "spawner_slimes_1",
          name: "Spawner_slime",
        },
        Spawner: {
          spawnPrefabId: "slime",
          maxCount: 4,
          interval: 10,
          timer: 0,
          spawnRadius: 3.0,
        },
      },
    },
    {
      prefabId: "spawner",
      overrides: {
        Position: { x: 40, y: 35, angle: 0 },
        Identity: {
          uuid: "spawner_slimes_2",
          name: "Spawner_slime",
        },
        Spawner: {
          spawnPrefabId: "slime",
          maxCount: 4,
          interval: 10,
          timer: 0,
          spawnRadius: 3.0,
        },
      },
    },
    {
      prefabId: "spawner",
      overrides: {
        Position: { x: 42, y: 13, angle: 0 },
        Identity: {
          uuid: "spawner_pirates_1",
          name: "Spawner_pirate",
        },
        Spawner: {
          spawnPrefabId: "pirate",
          maxCount: 3,
          interval: 12,
          timer: 0,
          spawnRadius: 3.0,
        },
      },
    },
    {
      prefabId: "spawner",
      overrides: {
        Position: { x: 40, y: 17, angle: 0 },
        Identity: {
          uuid: "spawner_pirates_2",
          name: "Spawner_pirate",
        },
        Spawner: {
          spawnPrefabId: "pirate",
          maxCount: 3,
          interval: 12,
          timer: 0,
          spawnRadius: 3.0,
        },
      },
    },
  ];

  return {
    id: "overworld",
    name: "Realm of the Ancients",
    width,
    height,
    spawnPoint: { x: 32, y: 54 },
    ground,
    walls,
    entities,
  };
}
