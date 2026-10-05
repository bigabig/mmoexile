import { VoxelModel, getVoxel } from "./types.js";

export interface ThumbnailOptions {
  size?: number; // Target width/height in px (default 32)
  outline?: boolean; // Add dark outline around sprite (default true)
  outlineColor?: string; // Outline color (default '#18181b')
}

/**
 * Generates an SVG string representation of a VoxelModel as a crisp 2D pixel-art icon.
 * Projects the front-most non-transparent voxels along the Z-axis onto an XY grid with optional dark outlines.
 */
export function voxelModelToSvg(
  model: VoxelModel,
  options: ThumbnailOptions = {},
): string {
  const targetSize = options.size ?? 32;
  const outline = options.outline ?? true;
  const outlineColor = options.outlineColor ?? "#18181b";

  const [sx, sy, sz] = model.size;

  // 2D grid of colors: grid[y][x] where y=0 is top
  // In VoxelModel, y=0 is bottom, so we invert Y for standard screen coordinates
  const pixelGrid: (string | null)[][] = Array.from({ length: sy }, () =>
    Array.from({ length: sx }, () => null),
  );

  for (let vy = 0; vy < sy; vy++) {
    const screenY = sy - 1 - vy;
    for (let vx = 0; vx < sx; vx++) {
      // Find the front-most non-transparent voxel along Z (from sz-1 down to 0)
      for (let vz = sz - 1; vz >= 0; vz--) {
        const colorIdx = getVoxel(model, vx, vy, vz);
        if (colorIdx > 0 && colorIdx < model.palette.length) {
          const color = model.palette[colorIdx];
          if (color && color !== "#00000000") {
            pixelGrid[screenY][vx] = color;
            break;
          }
        }
      }
    }
  }

  // Padding to fit outline if enabled
  const pad = outline ? 1 : 0;
  const totalW = sx + pad * 2;
  const totalH = sy + pad * 2;

  const rects: string[] = [];

  // 1. Draw outline if requested
  if (outline) {
    const outlineSet = new Set<string>();
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        if (pixelGrid[y][x] !== null) {
          // Check 4-directional neighbors
          const neighbors = [
            [x + 1, y],
            [x - 1, y],
            [x, y + 1],
            [x, y - 1],
            [x + 1, y + 1],
            [x - 1, y - 1],
            [x + 1, y - 1],
            [x - 1, y + 1],
          ];
          for (const [nx, ny] of neighbors) {
            if (
              nx < 0 ||
              nx >= sx ||
              ny < 0 ||
              ny >= sy ||
              pixelGrid[ny][nx] === null
            ) {
              outlineSet.add(`${nx + pad},${ny + pad}`);
            }
          }
        }
      }
    }

    for (const pos of outlineSet) {
      const [ox, oy] = pos.split(",").map(Number);
      rects.push(
        `<rect x="${ox}" y="${oy}" width="1" height="1" fill="${outlineColor}" />`,
      );
    }
  }

  // 2. Draw pixel rects
  for (let y = 0; y < sy; y++) {
    for (let x = 0; x < sx; x++) {
      const color = pixelGrid[y][x];
      if (color) {
        rects.push(
          `<rect x="${x + pad}" y="${y + pad}" width="1" height="1" fill="${color}" />`,
        );
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${targetSize}" height="${targetSize}" shape-rendering="crispEdges">${rects.join("")}</svg>`;
}

/**
 * Returns a data URI for direct use in <img src="..." /> or CSS background-image
 */
export function voxelModelToDataUrl(
  model: VoxelModel,
  options: ThumbnailOptions = {},
): string {
  const svg = voxelModelToSvg(model, options);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

