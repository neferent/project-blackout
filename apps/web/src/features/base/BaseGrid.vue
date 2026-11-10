<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  getItemDef,
  HEX_DIRECTIONS,
  SEED_BASE_LAYOUT_CONFIG,
  type LayoutItemInstance,
  type LayoutLink,
  type LayoutPlacement,
  type LayoutTile,
} from "@blackout/shared";
import { axialToPixel, hexCorners } from "../placement/hexGrid.js";
import { CELL } from "./boardCamera.js";
import { TILE_COLORS } from "./tileStyle.js";

export interface StationLabel {
  text: string;
  tone: "good" | "bad";
}

const props = withDefaults(
  defineProps<{
    tiles: LayoutTile[];
    placements: LayoutPlacement[];
    items: Record<string, LayoutItemInstance>;
    selected?: { q: number; r: number } | null;
    /** Item whose links are drawn emphasized (others fade). */
    focusItemId?: string | null;
    links?: LayoutLink[];
    labels?: Record<string, StationLabel>;
    /** Items failing hard validation (get a red ring). */
    badItemIds?: string[];
    /** Tiles the dragged/selected item may legally land on. */
    dropTargets?: { q: number; r: number }[];
    /** World point at the viewport center, and zoom (see boardCamera.ts). */
    cam: { x: number; y: number };
    zoom: number;
    /** Dim everything (used while the base is locked mid-rearrange). */
    dimmed?: boolean;
    /** Snap preview for an item being dragged: the tile it would land on. */
    preview?: { itemId: string; tile: { q: number; r: number }; valid: boolean } | null;
  }>(),
  {
    selected: null,
    focusItemId: null,
    links: () => [],
    labels: () => ({}),
    badItemIds: () => [],
    dropTargets: () => [],
    dimmed: false,
    preview: null,
  },
);
const emit = defineEmits<{
  (e: "down", payload: { tile: { q: number; r: number }; clientX: number; clientY: number }): void;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const GRID_LINE = "rgba(216, 212, 200, 0.3)";

const viewW = ref(0);
const viewH = ref(0);
let observer: ResizeObserver | null = null;

function toCanvas(p: { x: number; y: number }) {
  return {
    x: (p.x * CELL - props.cam.x) * props.zoom + viewW.value / 2,
    y: (p.y * CELL - props.cam.y) * props.zoom + viewH.value / 2,
  };
}

function trace(ctx: CanvasRenderingContext2D, corners: { x: number; y: number }[]) {
  ctx.beginPath();
  corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  center: { x: number; y: number },
  size: number,
  def: NonNullable<ReturnType<typeof getItemDef>>,
  bad: boolean,
) {
  const color = def.kind === "station" ? "#d9a441" : def.kind === "door" ? "#9ec1d9" : "#b9b3a3";
  ctx.beginPath();
  ctx.arc(center.x, center.y, size * (def.kind === "attachment" ? 0.42 : 0.62), 0, Math.PI * 2);
  ctx.fillStyle = "rgba(15,15,14,0.88)";
  ctx.fill();
  ctx.strokeStyle = bad ? "#e0705f" : color;
  ctx.lineWidth = bad ? 3 : 2;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = `600 ${Math.max(9, size * 0.5)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(def.name.slice(0, 2), center.x, center.y);
}

function draw() {
  const el = canvas.value;
  if (!el) return;
  if (!viewW.value || !viewH.value) return;
  const size = CELL * props.zoom;
  const dpr = window.devicePixelRatio || 1;
  el.width = Math.round(viewW.value * dpr); // also clears the canvas
  el.height = Math.round(viewH.value * dpr);
  const ctx = el.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const onScreen = (c: { x: number; y: number }) =>
    c.x > -size * 2 && c.y > -size * 2 && c.x < viewW.value + size * 2 && c.y < viewH.value + size * 2;

  for (const tile of props.tiles) {
    const center = toCanvas(axialToPixel(tile, 1));
    if (!onScreen(center)) continue;
    const corners = hexCorners(center, size);
    trace(ctx, corners);
    ctx.fillStyle = TILE_COLORS[tile.tileType];
    ctx.fill();

    if (tile.tileType === "indoor") {
      // Inset outline reads as walls/floor, distinct from open ground.
      trace(ctx, hexCorners(center, size * 0.78));
      ctx.strokeStyle = "rgba(216, 212, 200, 0.22)";
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (tile.tileType === "road") {
      // Faint lane line.
      ctx.setLineDash([size * 0.25, size * 0.2]);
      ctx.strokeStyle = "rgba(230, 200, 90, 0.4)";
      ctx.lineWidth = Math.max(1, size * 0.07);
      ctx.beginPath();
      ctx.moveTo(center.x - size * 0.8, center.y);
      ctx.lineTo(center.x + size * 0.8, center.y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (tile.tileType === "paved") {
      trace(ctx, hexCorners(center, size * 0.86));
      ctx.strokeStyle = "rgba(216, 212, 200, 0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (tile.designation === "walkway") {
      // Lighter floor with a dotted path line: reads as a clear route to walk.
      trace(ctx, hexCorners(center, size * 0.92));
      ctx.fillStyle = "rgba(226, 208, 150, 0.3)";
      ctx.fill();
      ctx.setLineDash([size * 0.12, size * 0.14]);
      ctx.strokeStyle = "rgba(242, 226, 170, 0.8)";
      ctx.lineWidth = Math.max(1.5, size * 0.09);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(center.x - size * 0.5, center.y);
      ctx.lineTo(center.x + size * 0.5, center.y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (tile.designation === "clear") {
      // Dashed border and a cross: kept empty on purpose.
      trace(ctx, hexCorners(center, size * 0.8));
      ctx.setLineDash([size * 0.14, size * 0.1]);
      ctx.strokeStyle = "rgba(150, 190, 220, 0.75)";
      ctx.lineWidth = Math.max(1.5, size * 0.07);
      ctx.stroke();
      ctx.setLineDash([]);
      const k = size * 0.26;
      ctx.beginPath();
      ctx.moveTo(center.x - k, center.y - k);
      ctx.lineTo(center.x + k, center.y + k);
      ctx.moveTo(center.x + k, center.y - k);
      ctx.lineTo(center.x - k, center.y + k);
      ctx.stroke();
    }

    trace(ctx, corners);
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  for (const t of props.dropTargets) {
    trace(ctx, hexCorners(toCanvas(axialToPixel(t, 1)), size * 0.92));
    ctx.fillStyle = "rgba(242, 210, 122, 0.16)";
    ctx.fill();
  }

  const centerOf = new Map(props.placements.map((p) => [p.itemId, toCanvas(axialToPixel(p, 1))]));

  // Links between items that influence each other, under the item glyphs.
  for (const link of props.links) {
    const a = centerOf.get(link.fromItemId);
    const b = centerOf.get(link.toItemId);
    if (!a || !b) continue;
    const faded = props.focusItemId && link.fromItemId !== props.focusItemId && link.toItemId !== props.focusItemId;
    const bad = link.value < 0;
    const attach = link.kind === "attachment";
    const strength = attach ? 0.6 : Math.min(1, Math.abs(link.value) / 0.1 + 0.4);
    ctx.save();
    ctx.globalAlpha = faded ? 0.18 : 0.35 + 0.65 * strength;
    ctx.strokeStyle = bad ? "#e0705f" : attach ? "#b9b3a3" : "#f2d27a";
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = attach ? 0 : bad ? 4 : 10;
    ctx.lineWidth = Math.max(2, size * (attach ? 0.1 : 0.14));
    ctx.lineCap = "round";
    ctx.setLineDash(bad ? [size * 0.3, size * 0.25] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  const previewing = props.preview?.itemId ?? null;
  for (const p of props.placements) {
    const instance = props.items[p.itemId];
    const def = instance && getItemDef(SEED_BASE_LAYOUT_CONFIG, instance.definitionId);
    if (!def) continue;
    const center = centerOf.get(p.itemId)!;
    ctx.save();
    if (p.itemId === previewing) ctx.globalAlpha = 0.3; // being dragged: leave a faded marker behind
    drawItem(ctx, center, size, def, props.badItemIds.includes(p.itemId));
    ctx.restore();

    const label = props.labels[p.itemId];
    if (label && p.itemId !== previewing) {
      ctx.font = `700 ${Math.max(9, size * 0.46)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(15,15,14,0.95)";
      ctx.strokeText(label.text, center.x, center.y + size * 0.98);
      ctx.fillStyle = label.tone === "good" ? "#7fd18a" : "#e0705f";
      ctx.fillText(label.text, center.x, center.y + size * 0.98);
    }
  }

  // Snap preview for a dragged item: the tile it would land on plus a ghost of the item.
  if (props.preview) {
    const instance = props.items[props.preview.itemId];
    const def = instance && getItemDef(SEED_BASE_LAYOUT_CONFIG, instance.definitionId);
    const center = toCanvas(axialToPixel(props.preview.tile, 1));
    const ok = props.preview.valid;
    trace(ctx, hexCorners(center, size * 0.96));
    ctx.fillStyle = ok ? "rgba(127, 209, 138, 0.22)" : "rgba(224, 112, 95, 0.22)";
    ctx.fill();
    ctx.strokeStyle = ok ? "#7fd18a" : "#e0705f";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (def) {
      ctx.save();
      ctx.globalAlpha = ok ? 0.85 : 0.45;
      drawItem(ctx, center, size, def, false);
      ctx.restore();
    }
  }

  if (props.selected) {
    const center = toCanvas(axialToPixel(props.selected, 1));
    trace(ctx, hexCorners(center, size * 0.98));
    ctx.strokeStyle = "#f2d27a";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

/** Nearest tile center to a pointer position, or null if it's off the board. */
function tileAt(clientX: number, clientY: number): { q: number; r: number } | null {
  const el = canvas.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let best: { q: number; r: number } | null = null;
  let bestDist = Infinity;
  for (const tile of props.tiles) {
    const c = toCanvas(axialToPixel(tile, 1));
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = tile;
    }
  }
  return bestDist <= CELL * props.zoom ? best && { q: best.q, r: best.r } : null;
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return; // middle/right drag is panning, handled by the parent
  const tile = tileAt(e.clientX, e.clientY);
  if (tile) emit("down", { tile, clientX: e.clientX, clientY: e.clientY });
}

defineExpose({ tileAt });
onMounted(() => {
  const el = canvas.value;
  if (el) {
    observer = new ResizeObserver(() => {
      viewW.value = el.clientWidth;
      viewH.value = el.clientHeight;
    });
    observer.observe(el);
    viewW.value = el.clientWidth;
    viewH.value = el.clientHeight;
  }
  draw();
});
onBeforeUnmount(() => {
  observer?.disconnect();
});
watch(
  () => [props.tiles, props.placements, props.items, props.selected, props.cam, props.zoom, viewW.value, viewH.value, props.links, props.labels, props.badItemIds, props.dropTargets, props.focusItemId, props.preview],
  draw,
  { deep: true },
);
</script>

<template>
  <canvas
    ref="canvas"
    class="base-grid"
    :class="{ dimmed }"
    @pointerdown="onPointerDown"
  ></canvas>
</template>

<style scoped>
.base-grid {
  cursor: pointer;
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  user-select: none;
}
.base-grid.dimmed {
  opacity: 0.55;
}
</style>
