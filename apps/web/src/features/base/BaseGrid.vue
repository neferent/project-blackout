<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  BASE_HEX_RADIUS,
  getItemDef,
  HEX_DIRECTIONS,
  SEED_BASE_LAYOUT_CONFIG,
  type LayoutItemInstance,
  type LayoutLink,
  type LayoutPlacement,
  type LayoutTile,
} from "@blackout/shared";
import { axialToPixel, hexCorners, hexOfHexesBounds } from "../placement/hexGrid.js";
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
    width?: number;
    /** Dim everything (used while the base is locked mid-rearrange). */
    dimmed?: boolean;
  }>(),
  { width: 440, selected: null, focusItemId: null, links: () => [], labels: () => ({}), badItemIds: () => [], dropTargets: () => [], dimmed: false },
);
const emit = defineEmits<{
  (e: "down", payload: { tile: { q: number; r: number }; clientX: number; clientY: number }): void;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const GRID_LINE = "rgba(216, 212, 200, 0.3)";

const bounds = computed(() => hexOfHexesBounds(BASE_HEX_RADIUS, 1));
const cellSize = computed(() => props.width / (bounds.value.maxX - bounds.value.minX));
const margin = computed(() => cellSize.value);

function toCanvas(p: { x: number; y: number }) {
  return { x: (p.x - bounds.value.minX) * cellSize.value + margin.value, y: (p.y - bounds.value.minY) * cellSize.value + margin.value };
}

function trace(ctx: CanvasRenderingContext2D, corners: { x: number; y: number }[]) {
  ctx.beginPath();
  corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function draw() {
  const el = canvas.value;
  if (!el) return;
  const size = cellSize.value;
  el.width = Math.ceil((bounds.value.maxX - bounds.value.minX) * size + margin.value * 2);
  el.height = Math.ceil((bounds.value.maxY - bounds.value.minY) * size + margin.value * 2);
  el.style.width = `${el.width}px`;
  el.style.height = `${el.height}px`;
  const ctx = el.getContext("2d");
  if (!ctx) return;

  for (const tile of props.tiles) {
    const center = toCanvas(axialToPixel(tile, 1));
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
    const strength = Math.min(1, Math.abs(link.value) / 0.1 + 0.4);
    ctx.save();
    ctx.globalAlpha = faded ? 0.18 : 0.35 + 0.65 * strength;
    ctx.strokeStyle = bad ? "#e0705f" : "#f2d27a";
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = bad ? 4 : 10;
    ctx.lineWidth = Math.max(2, size * 0.14);
    ctx.lineCap = "round";
    ctx.setLineDash(bad ? [size * 0.3, size * 0.25] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  for (const p of props.placements) {
    const instance = props.items[p.itemId];
    const def = instance && getItemDef(SEED_BASE_LAYOUT_CONFIG, instance.definitionId);
    if (!def) continue;
    const center = centerOf.get(p.itemId)!;
    const color = def.kind === "station" ? "#d9a441" : def.kind === "door" ? "#9ec1d9" : "#b9b3a3";
    const bad = props.badItemIds.includes(p.itemId);
    ctx.beginPath();
    ctx.arc(center.x, center.y, size * (def.kind === "attachment" ? 0.42 : 0.62), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(15,15,14,0.88)";
    ctx.fill();
    ctx.strokeStyle = bad ? "#e0705f" : color;
    ctx.lineWidth = bad ? 3 : 2;
    ctx.stroke();

    // Facing tick toward the neighbor this item faces.
    const dir = axialToPixel(HEX_DIRECTIONS[p.facing], 1);
    const len = Math.hypot(dir.x, dir.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(center.x + (dir.x / len) * size * 0.85, center.y + (dir.y / len) * size * 0.85);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = `600 ${Math.max(9, size * 0.5)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.name.slice(0, 2), center.x, center.y);

    const label = props.labels[p.itemId];
    if (label) {
      ctx.font = `700 ${Math.max(9, size * 0.46)}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(15,15,14,0.95)";
      ctx.strokeText(label.text, center.x, center.y + size * 0.98);
      ctx.fillStyle = label.tone === "good" ? "#7fd18a" : "#e0705f";
      ctx.fillText(label.text, center.x, center.y + size * 0.98);
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
  return bestDist <= cellSize.value ? best && { q: best.q, r: best.r } : null;
}

function onPointerDown(e: PointerEvent) {
  const tile = tileAt(e.clientX, e.clientY);
  if (tile) emit("down", { tile, clientX: e.clientX, clientY: e.clientY });
}

defineExpose({ tileAt });
onMounted(draw);
watch(
  () => [props.tiles, props.placements, props.items, props.selected, props.width, props.links, props.labels, props.badItemIds, props.dropTargets, props.focusItemId],
  draw,
  { deep: true },
);
</script>

<template>
  <canvas ref="canvas" class="base-grid" :class="{ dimmed }" @pointerdown="onPointerDown"></canvas>
</template>

<style scoped>
.base-grid {
  display: block;
  max-width: 100%;
  touch-action: none;
  cursor: pointer;
  user-select: none;
}
.base-grid.dimmed {
  opacity: 0.55;
}
</style>
