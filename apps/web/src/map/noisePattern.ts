/**
 * Procedural speckle tile used as a MapLibre image pattern (see style.ts's "ground-noise"
 * layer). Mostly-transparent so it reads as grit/rubble texture on the ground plane rather
 * than a solid tinted tile — register once per Map instance via `map.addImage(id, ...)`.
 */
export function createGroundNoiseImage(size = 64): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const roll = Math.random();
    // Only ~18% of pixels get a speckle; the rest stay fully transparent.
    const alpha = roll > 0.82 ? (roll - 0.82) / 0.18 : 0;
    const gray = 40 + Math.random() * 90;
    const idx = i * 4;
    data[idx] = gray;
    data[idx + 1] = gray;
    data[idx + 2] = gray * 0.9;
    data[idx + 3] = Math.round(alpha * 255);
  }
  return { width: size, height: size, data };
}

/**
 * Tileable ripple texture for the water layer (see style.ts's "water-ripple" layer): thin
 * wavy contour lines rather than a thresholded blob field (which reads as polka dots).
 * `bands` and `wobbleCycles` are integer counts per tile so both axes stay periodic over
 * `size` and the tile repeats with no visible seam.
 */
export function createWaterRippleImage(
  size = 128,
  bands = 5,
  wobbleCycles = 3,
): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(size * size * 4);
  const wobbleAmplitude = 0.15;
  const lineHalfWidth = 0.1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const wobble = Math.sin(2 * Math.PI * wobbleCycles * u) * wobbleAmplitude;
      // Distance from the nearest zero-crossing of this wavy band pattern — thin near 0,
      // fading out by lineHalfWidth. That draws a line along the contour, not a filled blob.
      const distanceFromLine = Math.abs(Math.sin(2 * Math.PI * (bands * v + wobble)));
      const alpha = distanceFromLine < lineHalfWidth ? 1 - distanceFromLine / lineHalfWidth : 0;
      const idx = (y * size + x) * 4;
      data[idx] = 60;
      data[idx + 1] = 110;
      data[idx + 2] = 100;
      data[idx + 3] = Math.round(alpha * 130);
    }
  }
  return { width: size, height: size, data };
}

/**
 * Blocky rubble/debris tile for the "building-debris" fill-extrusion layer (see style.ts) —
 * texture-mapped onto extruded buildings' roof/wall faces via fill-extrusion-pattern.
 * Chunk-sized cells (vs. single-pixel speckle) read as scattered rubble rather than fine
 * dust; mostly transparent so the building's own color still shows through underneath.
 */
export function createRoofDebrisImage(
  size = 64,
  blockSize = 4,
): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let blockY = 0; blockY < size; blockY += blockSize) {
    for (let blockX = 0; blockX < size; blockX += blockSize) {
      if (Math.random() > 0.85) continue; // most cells stay empty/transparent
      const gray = 25 + Math.random() * 150;
      const baseAlpha = 70 + Math.random() * 50;
      for (let y = blockY; y < Math.min(blockY + blockSize, size); y++) {
        for (let x = blockX; x < Math.min(blockX + blockSize, size); x++) {
          // Randomly drop pixels and jitter alpha within the block so edges are ragged
          // rather than a crisp rectangle — a uniform solid block reads as a camo patch.
          if (Math.random() > 0.65) continue;
          const idx = (y * size + x) * 4;
          data[idx] = gray;
          data[idx + 1] = gray * 0.95;
          data[idx + 2] = gray * 0.85;
          data[idx + 3] = Math.round(baseAlpha * (0.5 + Math.random() * 0.5));
        }
      }
    }
  }
  return { width: size, height: size, data };
}

/**
 * Cracked-earth fissure tile for the "landcover-cracks" layer (see style.ts): a Voronoi-cell
 * boundary pattern (distance to nearest vs. second-nearest random seed point) — the standard
 * technique for generating jagged, dried-mud-style crack networks. Seed points are wrapped
 * across the 3x3 neighboring tiles so the boundaries line up seamlessly at the tile edges.
 */
export function createCrackedEarthImage(
  size = 128,
  cellCount = 10,
): { width: number; height: number; data: Uint8ClampedArray } {
  const points: Array<[number, number]> = Array.from({ length: cellCount }, () => [
    Math.random() * size,
    Math.random() * size,
  ]);
  const data = new Uint8ClampedArray(size * size * 4);
  const lineWidth = 1.6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let nearest = Infinity;
      let secondNearest = Infinity;
      for (const [px, py] of points) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          for (let offsetY = -1; offsetY <= 1; offsetY++) {
            const dx = x - (px + offsetX * size);
            const dy = y - (py + offsetY * size);
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < nearest) {
              secondNearest = nearest;
              nearest = dist;
            } else if (dist < secondNearest) {
              secondNearest = dist;
            }
          }
        }
      }
      // Small gap between the two closest seed points means this pixel sits on (or near) a
      // cell boundary — that's the crack line.
      const distanceFromBoundary = secondNearest - nearest;
      const idx = (y * size + x) * 4;
      if (distanceFromBoundary < lineWidth) {
        const alpha = 1 - distanceFromBoundary / lineWidth;
        data[idx] = 15;
        data[idx + 1] = 12;
        data[idx + 2] = 10;
        data[idx + 3] = Math.round(alpha * 180);
      }
    }
  }
  return { width: size, height: size, data };
}
