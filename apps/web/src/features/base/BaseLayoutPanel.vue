<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  getItemDef,
  interactionCellForPosition,
  realSecondsFromGameSeconds,
  SEED_BASE_LAYOUT_CONFIG,
  type Designation,
} from "@blackout/shared";
import { usePlayerStore } from "../../stores/playerStore.js";
import BaseGrid, { type StationLabel } from "./BaseGrid.vue";
import { useBoardCamera } from "./boardCamera.js";
import ItemPalette from "./ItemPalette.vue";
import { useBaseStore } from "./baseStore.js";
import { useLayoutDraftStore } from "./layoutDraftStore.js";
import { DESIGNATION_NAMES, TILE_COLORS, TILE_NAMES, TILE_TYPE_ORDER, tileLabel } from "./tileStyle.js";

defineEmits<{ (e: "close"): void }>();

const baseStore = useBaseStore();
const draft = useLayoutDraftStore();

const grid = ref<InstanceType<typeof BaseGrid> | null>(null);
const paletteEl = ref<HTMLElement | null>(null);
const selectedTile = ref<{ q: number; r: number } | null>(null);
const selectedItemId = ref<string | null>(null);
const paletteSelectedId = ref<string | null>(null);

onMounted(async () => {
  await baseStore.load();
  draft.resetToCommitted();
});
// A finished layout action bumps the version; pick up the newly committed layout.
watch(
  () => baseStore.state?.layoutVersion,
  () => draft.resetToCommitted(),
);

/** While a layout action runs the base is locked: show the committed layout, read-only. */
const locked = computed(() => Boolean(baseStore.state?.activeLayoutAction));
const shownPlacements = computed(() => (locked.value ? draft.committed : draft.placements));
/** Draft tiles carry the painted designations; while locked show what's committed. */
const shownTiles = computed(() => (locked.value ? (baseStore.state?.tiles ?? []) : draft.tiles));

const defOf = (itemId: string) => {
  const instance = draft.items[itemId];
  return instance ? getItemDef(SEED_BASE_LAYOUT_CONFIG, instance.definitionId) : undefined;
};

// --- Drag / tap handling -------------------------------------------------------------

interface Drag {
  itemId: string;
  source: "palette" | "board";
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}
const drag = ref<Drag | null>(null);
const DRAG_THRESHOLD_PX = 6;

function startDrag(itemId: string, source: Drag["source"], x: number, y: number) {
  drag.value = { itemId, source, startX: x, startY: y, x, y, moved: false };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", cancelDrag);
}

function stopListening() {
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", cancelDrag);
}

function cancelDrag() {
  stopListening();
  drag.value = null;
}

function onMove(e: PointerEvent) {
  const d = drag.value;
  if (!d) return;
  d.x = e.clientX;
  d.y = e.clientY;
  if (!d.moved && Math.hypot(d.x - d.startX, d.y - d.startY) > DRAG_THRESHOLD_PX) d.moved = true;
}

function onUp(e: PointerEvent) {
  const d = drag.value;
  stopListening();
  drag.value = null;
  if (!d) return;

  if (d.moved) {
    const tile = grid.value?.tileAt(e.clientX, e.clientY) ?? null;
    if (tile) {
      if (draft.place(d.itemId, tile)) {
        selectedItemId.value = d.itemId;
        selectedTile.value = tile;
        paletteSelectedId.value = null;
      }
    } else if (d.source === "board" && overPalette(e.clientX, e.clientY)) {
      draft.remove(d.itemId);
      selectedItemId.value = null;
    }
    return;
  }

  // A tap, not a drag.
  if (d.source === "palette") {
    paletteSelectedId.value = paletteSelectedId.value === d.itemId ? null : d.itemId;
    selectedItemId.value = null;
  } else {
    selectedItemId.value = d.itemId;
  }
}

function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
  if (!selectedItemId.value || locked.value || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "delete" || k === "backspace") removeSelected();
}
onMounted(() => window.addEventListener("keydown", onKey));

/** Snap preview while an item is dragged across the board. */
const preview = computed(() => {
  const d = drag.value;
  if (!d?.moved) return null;
  const tile = grid.value?.tileAt(d.x, d.y);
  if (!tile) return null;
  const here = draft.placements.find((p) => p.itemId === d.itemId);
  const valid = (here?.q === tile.q && here?.r === tile.r) || dropTargets.value.some((t) => t.q === tile.q && t.r === tile.r);
  return { itemId: d.itemId, tile, valid };
});

function overPalette(x: number, y: number): boolean {
  const r = paletteEl.value?.getBoundingClientRect();
  return Boolean(r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
}

// --- Tile designation painting ---------------------------------------------------------

type Tool = "items" | Designation | "erase";
const tool = ref<Tool>("items");
const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "items", label: "Items", hint: "Place and move items." },
  { id: "walkway", label: "Walkway", hint: "Paint floor to walk across. Indoor stations need a walkway to be reached from the door." },
  { id: "clear", label: "Keep clear", hint: "Paint tiles to keep empty. Nothing can be placed there." },
  { id: "erase", label: "Erase", hint: "Remove a walkway or keep-clear mark." },
];
const toolHint = computed(() => TOOLS.find((t) => t.id === tool.value)?.hint ?? "");
const painting = ref(false);
let lastPainted: string | null = null;

function paintTile(tile: { q: number; r: number }) {
  const key = `${tile.q},${tile.r}`;
  if (key === lastPainted) return;
  lastPainted = key;
  draft.paint(tile, tool.value === "erase" ? null : (tool.value as Designation));
}

function onPaintMove(e: PointerEvent) {
  const tile = grid.value?.tileAt(e.clientX, e.clientY);
  if (tile) paintTile(tile);
}

function endPaint() {
  painting.value = false;
  lastPainted = null;
  window.removeEventListener("pointermove", onPaintMove);
  window.removeEventListener("pointerup", endPaint);
  window.removeEventListener("pointercancel", endPaint);
}

function startPaint(tile: { q: number; r: number }) {
  selectedItemId.value = null;
  paletteSelectedId.value = null;
  painting.value = true;
  paintTile(tile);
  window.addEventListener("pointermove", onPaintMove);
  window.addEventListener("pointerup", endPaint);
  window.addEventListener("pointercancel", endPaint);
}

function setTool(next: Tool) {
  tool.value = next;
  if (next !== "items") {
    selectedItemId.value = null;
    paletteSelectedId.value = null;
  }
}

function onBoardDown(e: { tile: { q: number; r: number }; clientX: number; clientY: number }) {
  selectedTile.value = e.tile;
  if (locked.value) return;
  if (tool.value !== "items") {
    startPaint(e.tile);
    return;
  }
  const placement = draft.placements.find((p) => p.q === e.tile.q && p.r === e.tile.r);
  if (placement) {
    startDrag(placement.itemId, "board", e.clientX, e.clientY);
    return;
  }
  // Tap-to-place fallback: a palette item is armed, tap an empty tile.
  if (paletteSelectedId.value && draft.place(paletteSelectedId.value, e.tile)) {
    selectedItemId.value = paletteSelectedId.value;
    paletteSelectedId.value = null;
  } else if (!paletteSelectedId.value) {
    selectedItemId.value = null;
  }
}

function onPaletteDown(e: { itemId: string; clientX: number; clientY: number }) {
  startDrag(e.itemId, "palette", e.clientX, e.clientY);
}

onBeforeUnmount(() => {
  stopListening();
  endPaint();
  window.removeEventListener("keydown", onKey);
});

function removeSelected() {
  if (!selectedItemId.value) return;
  draft.remove(selectedItemId.value);
  selectedItemId.value = null;
}

// --- Derived display -----------------------------------------------------------------

const dropTargets = computed(() => {
  const id = drag.value?.moved ? drag.value.itemId : paletteSelectedId.value;
  return id ? draft.dropTargets(id) : [];
});

const evaluation = computed(() => (locked.value ? (baseStore.state?.evaluation ?? draft.evaluation) : draft.evaluation));

const stationLabels = computed<Record<string, StationLabel>>(() => {
  const out: Record<string, StationLabel> = {};
  for (const s of Object.values(evaluation.value.stations)) {
    const pct = Math.round(Math.abs(s.bonus) * 100);
    if (pct === 0) continue;
    out[s.itemId] = s.bonus > 0 ? { text: `−${pct}%`, tone: "good" } : { text: `+${pct}%`, tone: "bad" };
  }
  return out;
});

const badItemIds = computed(() => (locked.value ? [] : draft.errors.flatMap((e) => (e.itemId ? [e.itemId] : []))));

const stationRows = computed(() =>
  Object.values(evaluation.value.stations).map((s) => {
    const pct = Math.round(s.bonus * 100);
    return {
      id: s.itemId,
      name: defOf(s.itemId)?.name ?? "Station",
      text: pct === 0 ? "no change" : pct > 0 ? `−${pct}% time` : `+${-pct}% time`,
      tone: pct > 0 ? "good" : pct < 0 ? "bad" : "",
      breakdown: s.breakdown,
      capped: s.positive > s.cappedPositive,
    };
  }),
);

const focusRow = computed(() => stationRows.value.find((r) => r.id === selectedItemId.value) ?? null);

const hardErrors = computed(() => (locked.value ? [] : draft.errors));

const selectedInfo = computed(() => {
  const state = baseStore.state;
  const sel = selectedTile.value;
  if (!state || !sel) return null;
  const tile = shownTiles.value.find((t) => t.q === sel.q && t.r === sel.r);
  if (!tile) return null;
  const placement = shownPlacements.value.find((p) => p.q === sel.q && p.r === sel.r);
  const instance = placement && draft.items[placement.itemId];
  const def = placement && defOf(placement.itemId);
  return {
    label: tileLabel(tile.tileType) + (tile.designation ? ` · ${DESIGNATION_NAMES[tile.designation]}` : ""),
    item: def && instance ? `${def.name} (quality ${instance.quality.toFixed(1)})` : null,
  };
});

const draggedName = computed(() => (drag.value?.moved ? (defOf(drag.value.itemId)?.name ?? "") : ""));

// --- Commit / discard / progress -----------------------------------------------------

const playerStore = usePlayerStore();
const atBase = computed(() => {
  const s = playerStore.state;
  return Boolean(s && interactionCellForPosition(s.position) === s.baseH3Cell);
});

function formatGameHours(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function formatReal(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

const costText = computed(() => {
  const plan = draft.plan;
  if (plan.ok) {
    return `${formatGameHours(plan.cost.hours)} game time · ${formatReal(realSecondsFromGameSeconds(plan.gameSeconds))} real`;
  }
  return plan.reason === "no-changes" ? "No changes yet" : "Fix the errors to commit";
});

const blockReason = computed(() => {
  if (!draft.dirty || !draft.plan.ok) return null;
  return atBase.value ? null : "You need to be at your base to commit.";
});
const canCommit = computed(() => draft.plan.ok && atBase.value && !draft.committing && !locked.value);

function discard() {
  draft.resetToCommitted();
  selectedItemId.value = null;
  paletteSelectedId.value = null;
}

// While a layout action runs, tick once a second for the countdown (display only — the
// server's ends_at is authoritative and the store re-reads right after it).
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;
watch(
  locked,
  (isLocked) => {
    clearInterval(tick);
    if (isLocked) tick = setInterval(() => (now.value = Date.now()), 1000);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(tick));

const progress = computed(() => {
  const a = baseStore.state?.activeLayoutAction;
  if (!a) return null;
  const start = new Date(a.startsAt).getTime();
  const end = new Date(a.endsAt).getTime();
  const fraction = end > start ? Math.min(1, Math.max(0, (now.value - start) / (end - start))) : 1;
  return {
    fraction,
    realLeft: formatReal((end - now.value) / 1000),
    gameHours: formatGameHours(a.hours),
  };
});

const viewport = ref<HTMLElement | null>(null);
const edgeScroll = ref(true);
const camera = useBoardCamera(
  viewport,
  (x, y) => Boolean(grid.value?.tileAt(x, y)),
  () => edgeScroll.value && !locked.value,
);
const { cam, zoom, panning } = camera;
// The viewport is v-if'd on the loaded base state; fit the board when it first appears.
watch(viewport, (el) => el && nextTick(() => camera.recenter()));
</script>

<template>
  <div class="base-overlay" @click.self="$emit('close')">
    <div class="base-panel">
      <header>
        <h2>Your base <span v-if="draft.dirty && !locked" class="badge">unsaved plan</span></h2>
        <button class="close" aria-label="Close" @click="$emit('close')">×</button>
      </header>

      <p v-if="baseStore.loading && !baseStore.state" class="note">Loading…</p>
      <p v-else-if="baseStore.error" class="note error">{{ baseStore.error }}</p>
      <div v-if="locked && progress" class="locked-banner">
        <strong>Rearranging your base…</strong>
        <div class="bar"><div class="fill" :style="{ width: `${progress.fraction * 100}%` }"></div></div>
        <span>{{ progress.realLeft }} left · {{ progress.gameHours }} of game time. Nothing here is usable until it's done.</span>
      </div>

      <template v-if="baseStore.state">
        <div class="zoom-bar">
          <span class="hint keys">Wheel zoom · WASD/arrows or screen edge to move · drag to look around · Space to recenter</span>
          <label class="edge-toggle"><input v-model="edgeScroll" type="checkbox" /> Edge scroll</label>
          <button aria-label="Zoom out" @click="camera.zoomTo(zoom / 1.25)">−</button>
          <button class="zoom-readout" aria-label="Recenter" @click="camera.recenter()">Fit</button>
          <button aria-label="Zoom in" @click="camera.zoomTo(zoom * 1.25)">+</button>
        </div>
        <div v-if="!locked" class="tool-bar" role="toolbar" aria-label="Board tool">
          <button
            v-for="t in TOOLS"
            :key="t.id"
            :class="{ active: tool === t.id }"
            :title="t.hint"
            @click="setTool(t.id)"
          >{{ t.label }}</button>
          <span v-if="tool !== 'items'" class="hint">{{ toolHint }} Drag to paint several tiles.</span>
        </div>
        <div
          ref="viewport"
          class="grid-viewport"
          :class="{ panning }"
          @wheel="camera.handlers.onWheel"
          @pointerdown="camera.handlers.onPointerDown"
          @pointermove="camera.handlers.onPointerMove"
          @pointerup="camera.handlers.onPointerUp"
          @pointercancel="camera.handlers.onPointerUp"
          @pointerleave="camera.handlers.onPointerLeave"
          @contextmenu.prevent
        >
          <BaseGrid
            ref="grid"
            :tiles="shownTiles"
            :placements="shownPlacements"
            :items="baseStore.state.items"
            :selected="selectedTile"
            :focus-item-id="selectedItemId"
            :links="evaluation.links"
            :labels="stationLabels"
            :bad-item-ids="badItemIds"
            :drop-targets="dropTargets"
            :cam="cam"
            :zoom="zoom"
            :dimmed="locked"
            :preview="preview"
            @down="onBoardDown"
          />
        </div>

        <div class="tile-info">
          <template v-if="selectedInfo">
            <strong>{{ selectedInfo.label }}</strong>
            <span v-if="selectedInfo.item"> — {{ selectedInfo.item }}</span>
          </template>
          <span v-else class="hint">Drag items onto the board. Place an attachment next to a station to link them.</span>
        </div>
        <p v-if="draft.message" class="note error">{{ draft.message }}</p>

        <div v-if="!locked" class="controls">
          <div class="cost">
            <span>Cost</span>
            <strong>{{ costText }}</strong>
          </div>
          <button class="secondary" :disabled="!draft.dirty || draft.committing" @click="discard">Discard</button>
          <button class="primary" :disabled="!canCommit" @click="draft.commit()">
            {{ draft.committing ? "Committing…" : "Commit" }}
          </button>
        </div>
        <p v-if="blockReason" class="hint">{{ blockReason }}</p>

        <div v-if="selectedItemId && !locked" class="item-actions">
          <button class="danger" @click="removeSelected">Remove</button>
        </div>

        <h3>Unplaced items</h3>
        <div ref="paletteEl">
          <ItemPalette
            :item-ids="draft.unplacedItemIds"
            :items="draft.items"
            :selected-id="paletteSelectedId"
            :disabled="locked"
            @down="onPaletteDown"
          />
        </div>
        <p v-if="paletteSelectedId" class="hint">Tap an empty tile to place it.</p>

        <h3>Efficiency</h3>
        <p v-if="stationRows.length === 0" class="hint">Place a station to see its time bonus.</p>
        <ul class="stations">
          <li v-for="row in stationRows" :key="row.id" :class="{ focus: row.id === selectedItemId }" @click="selectedItemId = row.id">
            <span>{{ row.name }}</span>
            <strong :class="row.tone">{{ row.text }}</strong>
            <ul v-if="row.id === selectedItemId" class="breakdown">
              <li v-for="(b, i) in row.breakdown" :key="i" :class="b.value > 0 ? 'good' : 'bad'">
                {{ b.label }} {{ b.value > 0 ? "−" : "+" }}{{ (Math.abs(b.value) * 100).toFixed(1) }}%
              </li>
              <li v-if="row.capped" class="hint">Bonus capped at {{ Math.round(draft.config.bonusCap * 100) }}%</li>
            </ul>
          </li>
        </ul>

        <ul v-if="evaluation.warnings.length || hardErrors.length" class="warnings">
          <li v-for="(e, i) in hardErrors" :key="`e${i}`" class="error">⛔ {{ e.message }}</li>
          <li v-for="(w, i) in evaluation.warnings" :key="`w${i}`">⚠ {{ w.message }}</li>
        </ul>

        <ul class="legend">
          <li v-for="type in TILE_TYPE_ORDER" :key="type">
            <span class="swatch" :style="{ background: TILE_COLORS[type] }"></span>{{ TILE_NAMES[type] }}
          </li>
          <li><span class="swatch walkway"></span>Walkway</li>
          <li><span class="swatch clear"></span>Keep clear</li>
        </ul>
      </template>
    </div>

    <div v-if="drag?.moved" class="ghost" :style="{ left: `${drag.x}px`, top: `${drag.y}px` }">{{ draggedName }}</div>
  </div>
</template>

<style scoped>
.base-overlay {
  position: fixed;
  inset: 0;
  z-index: 30;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  font-family: system-ui, sans-serif;
}
.base-panel {
  background: rgba(15, 15, 14, 0.97);
  border: 1px solid #34332c;
  border-radius: 6px;
  color: #d8d4c8;
  padding: 12px 14px;
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
h2 {
  margin: 0;
  font-size: 16px;
}
h3 {
  margin: 14px 0 6px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #8a8578;
}
.badge {
  margin-left: 6px;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid #8a6a2b;
  border-radius: 3px;
  color: #d9a441;
}
.close {
  background: none;
  border: none;
  color: #8a8578;
  font-size: 24px;
  line-height: 1;
  min-width: 44px;
  min-height: 44px;
  cursor: pointer;
}
.note {
  color: #8a8578;
  font-size: 13px;
}
.note.error,
.error {
  color: #e0705f;
}
.zoom-bar {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-bottom: 6px;
}
.zoom-bar button {
  min-width: 32px;
  height: 28px;
  background: #23221e;
  border: 1px solid #34332c;
  border-radius: 4px;
  color: #d8d4c8;
  cursor: pointer;
}
.zoom-bar button:disabled {
  opacity: 0.4;
  cursor: default;
}
.zoom-readout {
  min-width: 52px !important;
  font-size: 12px;
}
.grid-viewport {
  height: min(60vh, 520px);
  min-height: 260px;
  overflow: hidden;
  border: 1px solid #34332c;
  border-radius: 4px;
  background: #0d0d0c;
  overscroll-behavior: contain;
  touch-action: none;
}
.grid-viewport.panning,
.grid-viewport.panning :deep(canvas) {
  cursor: grabbing;
}
.keys {
  margin-right: auto;
  align-self: center;
}
.edge-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #8a8578;
}
.tile-info {
  min-height: 24px;
  margin: 8px 0;
  font-size: 13px;
}
.hint {
  color: #8a8578;
  font-size: 12px;
}
.locked-banner {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  padding: 10px;
  border: 1px solid #8a6a2b;
  border-radius: 4px;
  background: #1c1810;
  font-size: 12px;
  color: #d8d4c8;
}
.bar {
  height: 6px;
  background: #2a2820;
  border-radius: 3px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: #d9a441;
  transition: width 1s linear;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0 4px;
}
.cost {
  flex: 1 1 160px;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: #8a8578;
}
.cost strong {
  color: #d8d4c8;
  font-size: 13px;
}
.controls button {
  min-height: 44px;
  min-width: 88px;
  background: #1c1b17;
  border: 1px solid #55534a;
  border-radius: 4px;
  color: #d8d4c8;
  cursor: pointer;
}
.controls button.primary {
  background: #d9a441;
  border-color: #d9a441;
  color: #15140f;
  font-weight: 600;
}
.controls button:disabled {
  opacity: 0.45;
  cursor: default;
}
.item-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}
.item-actions button {
  min-height: 44px;
  min-width: 88px;
  background: #1c1b17;
  border: 1px solid #55534a;
  border-radius: 4px;
  color: #d8d4c8;
  cursor: pointer;
}
.item-actions .danger {
  border-color: #8a3a2f;
  color: #e0705f;
}
.stations,
.warnings,
.legend,
.breakdown {
  list-style: none;
  margin: 0;
  padding: 0;
}
.stations > li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 2px 8px;
  padding: 6px 4px;
  border-bottom: 1px solid #25241f;
  font-size: 13px;
  cursor: pointer;
}
.stations > li.focus {
  background: #1c1b17;
}
.breakdown {
  width: 100%;
  font-size: 12px;
}
.good {
  color: #7fd18a;
}
.bad {
  color: #e0705f;
}
.warnings {
  margin-top: 10px;
  font-size: 12px;
  color: #d9a441;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 14px;
  font-size: 12px;
  color: #a8a396;
}
.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 1px solid #55534a;
  margin-right: 5px;
  vertical-align: -1px;
}
.swatch.walkway {
  background: rgba(226, 208, 150, 0.45);
  border: 1px dotted #f2e2aa;
}
.swatch.clear {
  background: transparent;
  border: 1px dashed #96bedc;
}
.tool-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.tool-bar button {
  height: 28px;
  padding: 0 10px;
  background: #23221e;
  border: 1px solid #34332c;
  border-radius: 4px;
  color: #d8d4c8;
  cursor: pointer;
}
.tool-bar button.active {
  border-color: #f2d27a;
  color: #f2d27a;
}
.ghost {
  position: fixed;
  z-index: 40;
  transform: translate(-50%, -140%);
  padding: 6px 10px;
  background: rgba(217, 164, 65, 0.92);
  color: #15140f;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  pointer-events: none;
}
</style>
