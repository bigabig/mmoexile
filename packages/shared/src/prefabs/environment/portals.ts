import type { PortalPrefab } from "../types.js";
import { PortalTag } from "../../components/index.js";

export const NexusPortalPrefab: PortalPrefab = {
  id: "portal_nexus",
  name: "Nexus Portal",
  category: "portal",
  tags: [PortalTag],
  components: {
    Position: {
      x: 0,
      y: 0,
      angle: 0,
    },
    Identity: {
      name: "Nexus Portal",
      prefabId: "portal_nexus",
    },
    Model: {
      modelId: "portal_nexus",
      scale: 1.8,
    },
    Animation: {
      type: "float",
      speed: 3,
      amplitude: 0.15,
    },
    Minimap: {
      color: "#38bdf8",
      radius: 3,
      shape: "diamond",
    },
    Collider: {
      radius: 0.6,
      layer: "portal",
      isTrigger: true,
    },
    Portal: {
      targetWorldId: "nexus",
      name: "Nexus Portal",
      kind: "nexus",
    },
  },
};

export const RealmPortalPrefab: PortalPrefab = {
  id: "portal_realm",
  name: "Realm Portal",
  category: "portal",
  tags: [PortalTag],
  components: {
    Position: {
      x: 0,
      y: 0,
      angle: 0,
    },
    Identity: {
      name: "Realm Portal",
      prefabId: "portal_realm",
    },
    Model: {
      modelId: "portal_realm",
      scale: 1.8,
    },
    Animation: {
      type: "float",
      speed: 3,
      amplitude: 0.15,
    },
    Minimap: {
      color: "#22c55e",
      radius: 3,
      shape: "diamond",
    },
    Collider: {
      radius: 0.6,
      layer: "portal",
      isTrigger: true,
    },
    Portal: {
      targetWorldId: "realm",
      name: "Realm Portal",
      kind: "realm",
    },
  },
};

export const GolemDungeonPortalPrefab: PortalPrefab = {
  id: "portal_golem_dungeon",
  name: "Golem Lair Portal",
  category: "portal",
  tags: [PortalTag],
  components: {
    Position: {
      x: 0,
      y: 0,
      angle: 0,
    },
    Identity: {
      name: "Golem Lair Portal",
      prefabId: "portal_golem_dungeon",
    },
    Model: {
      modelId: "portal_golem_dungeon",
      scale: 2.0,
    },
    Animation: {
      type: "float",
      speed: 3,
      amplitude: 0.15,
    },
    Minimap: {
      color: "#a855f7",
      radius: 3.5,
      shape: "diamond",
    },
    Collider: {
      radius: 0.7,
      layer: "portal",
      isTrigger: true,
    },
    Portal: {
      targetWorldId: "golem_dungeon",
      name: "Golem Lair Portal",
      kind: "dungeon",
    },
  },
};
