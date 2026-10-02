import { MapData, MapEntityDef, TileType, WallType } from "./types.js";

/**
 * Creates the static 36x36 Golem Lair Dungeon map
 */
export function createGolemDungeonMap(): MapData {
  const width = 36;
  const height = 36;
  const ground = new Array(width * height).fill(TileType.VOID);
  const walls = new Array(width * height).fill(WallType.DUNGEON_WALL);

  const setFloor = (
    x: number,
    y: number,
    g: TileType = TileType.STONE_PATH,
  ) => {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      ground[x + y * width] = g;
      walls[x + y * width] = WallType.NONE;
    }
  };

  const fillRoom = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    g: TileType = TileType.STONE_PATH,
  ) => {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        setFloor(x, y, g);
      }
    }
  };

  // Entry Room (South)
  fillRoom(14, 26, 22, 32, TileType.STONE_PATH);

  // Corridor 1
  fillRoom(17, 20, 19, 25, TileType.STONE_PATH);

  // Middle Chamber with Lava
  fillRoom(12, 14, 24, 20, TileType.STONE_PATH);
  fillRoom(15, 16, 21, 18, TileType.LAVA); // Lava pit in middle

  // Corridor 2
  fillRoom(17, 10, 19, 13, TileType.STONE_PATH);

  // Boss Arena (North)
  fillRoom(8, 2, 28, 9, TileType.STONE_PATH);

  // Entities: Dungeon exits & spawners
  const entities: MapEntityDef[] = [
    {
      prefabId: "portal_nexus",
      overrides: {
        Position: { x: 18, y: 31, angle: 0 },
        Identity: {
          uuid: "portal_dungeon_to_nexus",
          name: "Exit to Nexus",
        },
        Portal: {
          targetZoneId: "nexus",
          name: "Exit to Nexus",
          kind: "nexus",
        },
      },
    },
    // Golem Boss spawner in north arena
    {
      prefabId: "spawner",
      overrides: {
        Position: { x: 18, y: 5, angle: 0 },
        Identity: {
          uuid: "spawner_golem_boss",
          name: "Spawner_golem_boss",
        },
        Spawner: {
          spawnPrefabId: "golem_boss",
          maxCount: 1,
          interval: 30,
          timer: 0,
          spawnRadius: 2.0,
        },
      },
    },
    {
      prefabId: "spawner",
      overrides: {
        Position: { x: 18, y: 15, angle: 0 },
        Identity: {
          uuid: "spawner_dungeon_slimes",
          name: "Spawner_slime",
        },
        Spawner: {
          spawnPrefabId: "slime",
          maxCount: 2,
          interval: 15,
          timer: 0,
          spawnRadius: 1.5,
        },
      },
    },
  ];

  return {
    id: "golem_dungeon",
    name: "Golem Lair Dungeon",
    width,
    height,
    spawnPoint: { x: 18, y: 29 },
    ground,
    walls,
    entities,
  };
}
