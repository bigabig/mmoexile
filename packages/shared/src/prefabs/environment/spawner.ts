import type { SpawnerPrefab } from "../types.js";
import { SpawnerTag } from "../../components/index.js";

export const GenericSpawnerPrefab: SpawnerPrefab = {
  id: "spawner",
  name: "Entity Spawner",
  category: "spawner",
  tags: [SpawnerTag],
  components: {
    Identity: {
      name: "Entity Spawner",
      prefabId: "spawner",
    },
    Position: {
      x: 0,
      y: 0,
      angle: 0,
    },
    Spawner: {
      spawnPrefabId: "slime",
      maxCount: 1,
      interval: 10,
      timer: 0,
      spawnRadius: 3.0,
    },
  },
};
