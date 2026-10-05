<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  CLASSIFICATION_COLORS,
  CLASSIFICATION_LABELS,
  CLASSIFICATION_ORDER,
  countBuildingCells,
  hexGridWarning,
  MIN_BASE_BUILDING_CELLS,
  type HexGridResult,
} from "./hexGrid.js";
import HexGridCanvas from "./HexGridCanvas.vue";

const props = defineProps<{
  grid: HexGridResult | null;
  city: string | null;
  cityLoading: boolean;
  creating: boolean;
  /** Screen position (viewport px) of the hex being previewed — see StartPicker, which
   * keeps this in sync with map pans/zooms while the popover is open. */
  anchor: { x: number; y: number };
}>();

defineEmits<{ confirm: [] }>();

// One combined popover — grid, stats and the confirm action together — rather than a
// percentage-only popover plus a separate "chosen hex" modal, so the player can see the
// buildable board for a hex without a second step.
const CANVAS_WIDTH = 220;
const OFFSET = 18;
const VIEWPORT_MARGIN = 16;
// Fallback used only for the one frame before the real element is measured (see
// ResizeObserver below) — its actual height varies with content (warning text, legend
// wrapping), so a fixed guess here is what let the popover run off-screen before.
const FALLBACK_SIZE = { width: 280, height: 360 };

const el = ref<HTMLElement | null>(null);
const size = ref(FALLBACK_SIZE);
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) return;
    size.value = { width: entry.contentRect.width, height: entry.contentRect.height };
  });
  watch(el, (node, _old, onCleanup) => {
    if (!node) return;
    resizeObserver?.observe(node);
    onCleanup(() => resizeObserver?.unobserve(node));
  }, { immediate: true });
});

onBeforeUnmount(() => resizeObserver?.disconnect());

// Clamped fully inside the viewport using the popover's actual measured size — the map
// container fills the whole viewport (see MapView.vue), so viewport bounds are the only
// clamp that matters here. Prefers the anchor's right side, flipping left if that would
// overflow, then clamps both axes so it can never run off any edge.
const style = computed(() => {
  const { width, height } = size.value;
  const overflowsRight = props.anchor.x + OFFSET + width > window.innerWidth - VIEWPORT_MARGIN;
  const desiredLeft = overflowsRight ? props.anchor.x - OFFSET - width : props.anchor.x + OFFSET;
  const desiredTop = props.anchor.y - height / 2;

  const maxLeft = window.innerWidth - VIEWPORT_MARGIN - width;
  const maxTop = window.innerHeight - VIEWPORT_MARGIN - height;
  const left = Math.min(Math.max(desiredLeft, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, maxLeft));
  const top = Math.min(Math.max(desiredTop, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, maxTop));

  return { left: `${left}px`, top: `${top}px` };
});

const buildingCount = computed(() => (props.grid ? countBuildingCells(props.grid) : 0));
const warning = computed(() => (props.grid ? hexGridWarning(props.grid) : null));
const canConfirm = computed(() => warning.value !== "no-buildings" && warning.value !== "too-few-buildings");

const WARNING_MESSAGES: Record<string, string> = {
  "no-buildings": "No buildings here — pick a hex with some shelter to build around.",
  "mostly-water": "Mostly water. You can still start here, but there's little dry land to build on.",
  "mostly-empty": "Mostly open land, with little else nearby.",
};

const warningMessage = computed(() => {
  if (!warning.value) return null;
  if (warning.value === "too-few-buildings") {
    return `Only ${buildingCount.value} building tile${buildingCount.value === 1 ? "" : "s"} — bases need at least ${MIN_BASE_BUILDING_CELLS}.`;
  }
  return WARNING_MESSAGES[warning.value];
});
</script>

<template>
  <div v-if="grid" ref="el" class="popover" :style="style">
    <div class="place">
      <span v-if="cityLoading">Locating…</span>
      <span v-else>{{ city ?? "Unknown area" }}</span>
    </div>

    <HexGridCanvas :grid="grid" :width="CANVAS_WIDTH" class="canvas" />

    <ul class="legend">
      <li v-for="key in CLASSIFICATION_ORDER" :key="key">
        <span class="swatch" :style="{ background: CLASSIFICATION_COLORS[key] }"></span>
        <span class="label">{{ CLASSIFICATION_LABELS[key] }}</span>
        <span class="value">{{ Math.round(grid.coverage[key] * 100) }}%</span>
      </li>
    </ul>

    <p v-if="warningMessage" class="warning" :class="{ blocking: !canConfirm }">⚠ {{ warningMessage }}</p>

    <button :disabled="!canConfirm || creating" @click="$emit('confirm')">
      {{ creating ? "Placing..." : "Confirm start point" }}
    </button>
  </div>
</template>

<style scoped>
.popover {
  position: fixed;
  width: 280px;
  background: rgba(15, 15, 14, 0.96);
  border: 1px solid #34332c;
  border-radius: 8px;
  padding: 12px;
  color: #d8d4c8;
  font-family: system-ui, sans-serif;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  z-index: 5;
}
.place {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #d8d4c8;
}
.canvas {
  display: block;
  margin: 0 auto 10px;
}
.legend {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 10px;
  font-size: 12px;
}
.legend li {
  display: flex;
  align-items: center;
  gap: 5px;
}
.legend .swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex: none;
  border: 1px solid rgba(216, 212, 200, 0.2);
}
.legend .label {
  color: #8a8578;
  flex: 1;
}
.legend .value {
  color: #d8d4c8;
}
.warning {
  font-size: 12px;
  color: #d9a441;
  margin: 0 0 8px;
  line-height: 1.4;
}
.warning.blocking {
  color: #c94f3f;
}
button {
  width: 100%;
  background: #c94f3f;
  color: #fff;
  border: none;
  padding: 8px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
