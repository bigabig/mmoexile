import { getItemDefinition } from "./index.js";
import { BUILTIN_VOXEL_MODELS } from "../voxels/models/index.js";
import { voxelModelToDataUrl } from "../voxels/thumbnail.js";

/**
 * Returns a data:image/svg+xml;utf8,... URL representing a 2D pixel-art icon for any item.
 */
export function getItemThumbnailDataUrl(
  itemId: string,
  size: number = 48,
): string | null {
  const itemDef = getItemDefinition(itemId);
  if (!itemDef) return null;

  const model = BUILTIN_VOXEL_MODELS[itemDef.modelId];
  if (!model) return null;

  return voxelModelToDataUrl(model, { size });
}
