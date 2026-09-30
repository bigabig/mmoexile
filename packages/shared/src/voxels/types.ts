export interface VoxelModel {
  name: string;
  palette: string[]; // Index 0 is air/transparent: '#00000000'
  size: [number, number, number]; // [width (X), height (Y), depth (Z)]
  voxels: number[]; // Flat array: index = x + y * size[0] + z * size[0] * size[1]
}

export function getVoxel(
  model: VoxelModel,
  x: number,
  y: number,
  z: number,
): number {
  const [sx, sy, sz] = model.size;
  if (x < 0 || x >= sx || y < 0 || y >= sy || z < 0 || z >= sz) return 0;
  return model.voxels[x + y * sx + z * sx * sy] ?? 0;
}

export function setVoxel(
  model: VoxelModel,
  x: number,
  y: number,
  z: number,
  colorIndex: number,
): void {
  const [sx, sy, sz] = model.size;
  if (x < 0 || x >= sx || y < 0 || y >= sy || z < 0 || z >= sz) return;
  model.voxels[x + y * sx + z * sx * sy] = colorIndex;
}

export function createEmptyVoxelModel(
  name: string,
  size: [number, number, number],
  palette: string[],
): VoxelModel {
  return {
    name,
    palette,
    size,
    voxels: new Array(size[0] * size[1] * size[2]).fill(0),
  };
}
