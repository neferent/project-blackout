<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { axialToPixel, CLASSIFICATION_COLORS, hexCorners, hexOfHexesBounds, type HexGridResult } from "./hexGrid.js";

const props = withDefaults(defineProps<{ grid: HexGridResult; width?: number }>(), { width: 440 });

const GRID_LINE_COLOR = "rgba(216, 212, 200, 0.35)";

const canvas = ref<HTMLCanvasElement | null>(null);

function draw() {
  const el = canvas.value;
  if (!el) return;
  const { radius, cells } = props.grid;

  const bounds = hexOfHexesBounds(radius, 1);
  const extentWidth = bounds.maxX - bounds.minX;
  const extentHeight = bounds.maxY - bounds.minY;
  // The canvas's drawing-buffer size is set directly to the target display size and never
  // rescaled by CSS afterward — letting the browser resample a crisp vector drawing after
  // the fact is exactly what produced uneven-looking cells before.
  const cellSize = props.width / extentWidth;
  const margin = cellSize; // room for cells at the very edge, whose corners extend past their center's bounds

  el.width = Math.ceil(extentWidth * cellSize + margin * 2);
  el.height = Math.ceil(extentHeight * cellSize + margin * 2);
  el.style.width = `${el.width}px`;
  el.style.height = `${el.height}px`;

  const ctx = el.getContext("2d");
  if (!ctx) return;

  const toCanvas = (p: { x: number; y: number }) => ({
    x: (p.x - bounds.minX) * cellSize + margin,
    y: (p.y - bounds.minY) * cellSize + margin,
  });

  for (const cell of cells) {
    const center = toCanvas(axialToPixel(cell, 1));
    const corners = hexCorners(center, cellSize);

    ctx.fillStyle = CLASSIFICATION_COLORS[cell.classification];
    ctx.beginPath();
    corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = GRID_LINE_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

onMounted(draw);
watch(() => [props.grid, props.width], draw);
</script>

<template>
  <canvas ref="canvas" class="hex-grid-canvas"></canvas>
</template>

<style scoped>
.hex-grid-canvas {
  border: 1px solid #2a2a26;
}
</style>
