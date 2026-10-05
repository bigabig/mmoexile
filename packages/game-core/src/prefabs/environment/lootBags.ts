import type { LootBagPrefab } from "../types.js";
import { LootBagTag } from "../../components/index.js";

export const BrownLootBagPrefab: LootBagPrefab = {
  id: "bag_brown",
  name: "Normal Loot Bag",
  category: "loot_bag",
  tags: [LootBagTag],
  components: {
    Position: {
      x: 0,
      y: 0,
      angle: 0,
    },
    Identity: {
      name: "Normal Loot Bag",
      prefabId: "bag_brown",
    },
    Model: {
      modelId: "bag_brown",
      scale: 0.6,
    },
    Animation: {
      type: "bob",
      speed: 4,
      amplitude: 0.1,
    },
    Minimap: {
      color: "#854d0e",
      radius: 2,
      shape: "square",
    },
    Collider: {
      radius: 0.5,
      layer: "item",
      isTrigger: true,
    },
    LootBag: {
      kind: "bag_brown",
      itemIds: [],
      createdAt: 0,
      maxLifetimeMs: 60000,
    },
  },
};

export const CyanLootBagPrefab: LootBagPrefab = {
  id: "bag_cyan",
  name: "Rare Loot Bag",
  category: "loot_bag",
  tags: [LootBagTag],
  components: {
    Position: {
      x: 0,
      y: 0,
      angle: 0,
    },
    Identity: {
      name: "Rare Loot Bag",
      prefabId: "bag_cyan",
    },
    Model: {
      modelId: "bag_cyan",
      scale: 0.65,
    },
    Animation: {
      type: "bob",
      speed: 4,
      amplitude: 0.1,
    },
    Minimap: {
      color: "#06b6d4",
      radius: 2.5,
      shape: "square",
    },
    Collider: {
      radius: 0.5,
      layer: "item",
      isTrigger: true,
    },
    LootBag: {
      kind: "bag_cyan",
      itemIds: [],
      createdAt: 0,
      maxLifetimeMs: 60000,
    },
  },
};
