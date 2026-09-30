import { Vec2 } from "../math/vec2.js";
import type { ComponentValueMap } from "../components/index.js";
import type { MapGeometry } from "./tiles.js";

export * from "./tiles.js";

export interface MapEntityDef {
  prefabId: string;
  overrides?: ComponentValueMap;
}

export interface MapData extends MapGeometry {
  id: string;
  name: string;
  width: number;
  height: number;
  spawnPoint: Vec2;
  ground: number[]; // size: width * height
  walls: number[]; // size: width * height (0 = none, >0 = WallType)
  entities: MapEntityDef[];
}
