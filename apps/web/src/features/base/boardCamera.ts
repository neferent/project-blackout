import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { BASE_HEX_RADIUS } from "@blackout/shared";
import { hexOfHexesBounds } from "../placement/hexGrid.js";

/** World units per hex "size" at zoom 1. Screen px = (world - cam) * zoom + viewport/2. */
export const CELL = 26;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3.5;
const PAN_SPEED_PX_S = 650; // screen px/s for keys and edge-scroll at full tilt
const EDGE_ZONE_PX = 28;
const DRAG_START_PX = 4;

const bounds = hexOfHexesBounds(BASE_HEX_RADIUS, CELL);
const boardCenter = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };

const PAN_KEYS: Record<string, [number, number]> = {
  w: [0, -1], arrowup: [0, -1],
  s: [0, 1], arrowdown: [0, 1],
  a: [-1, 0], arrowleft: [-1, 0],
  d: [1, 0], arrowright: [1, 0],
};

/**
 * Strategy-game camera for the base board: wheel zooms toward the cursor, WASD/arrows and
 * screen-edge scrolling pan, middle/right-drag (or left-drag on empty ground) grabs the map,
 * Home/Space re-centers. The camera is just (cam, zoom); BaseGrid draws from it.
 *
 * @param isTile  true if a client point is over a board tile (left-drag there belongs to items)
 * @param edgeScroll  whether pointer-near-edge scrolling is currently enabled
 */
export function useBoardCamera(viewport: Ref<HTMLElement | null>, isTile: (x: number, y: number) => boolean, edgeScroll: () => boolean) {
  const cam = ref({ x: boardCenter.x, y: boardCenter.y });
  const zoom = ref(1);
  const panning = ref(false);

  const size = () => ({ w: viewport.value?.clientWidth ?? 0, h: viewport.value?.clientHeight ?? 0 });

  function clampCam() {
    // Keep some of the board in view; allow roaming a little past its edges.
    const { w, h } = size();
    const slackX = w / (2 * zoom.value) * 0.6;
    const slackY = h / (2 * zoom.value) * 0.6;
    cam.value = {
      x: Math.min(bounds.maxX + slackX, Math.max(bounds.minX - slackX, cam.value.x)),
      y: Math.min(bounds.maxY + slackY, Math.max(bounds.minY - slackY, cam.value.y)),
    };
  }

  function fitZoom() {
    const { w, h } = size();
    if (!w || !h) return 1;
    return Math.min(w / (bounds.maxX - bounds.minX + CELL * 2), h / (bounds.maxY - bounds.minY + CELL * 2));
  }

  function recenter() {
    cam.value = { x: boardCenter.x, y: boardCenter.y };
    zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fitZoom()));
  }

  function panByScreen(dx: number, dy: number) {
    cam.value = { x: cam.value.x + dx / zoom.value, y: cam.value.y + dy / zoom.value };
    clampCam();
  }

  /** Zoom keeping the world point under (ax, ay) — viewport-relative px — fixed. Defaults to center. */
  function zoomTo(z: number, ax?: number, ay?: number) {
    const { w, h } = size();
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    const px = ax ?? w / 2;
    const py = ay ?? h / 2;
    const wx = cam.value.x + (px - w / 2) / zoom.value;
    const wy = cam.value.y + (py - h / 2) / zoom.value;
    zoom.value = next;
    cam.value = { x: wx - (px - w / 2) / next, y: wy - (py - h / 2) / next };
    clampCam();
  }

  // --- wheel ---------------------------------------------------------------------------
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = viewport.value!.getBoundingClientRect();
    zoomTo(zoom.value * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - rect.left, e.clientY - rect.top);
  }

  // --- grab-drag -----------------------------------------------------------------------
  let grab: { x: number; y: number; started: boolean } | null = null;
  const pointer = { x: 0, y: 0, inside: false };

  function onPointerDown(e: PointerEvent) {
    if (e.button === 0 && isTile(e.clientX, e.clientY)) return;
    grab = { x: e.clientX, y: e.clientY, started: e.button !== 0 };
    if (grab.started) begin(e);
  }
  function begin(e: PointerEvent) {
    panning.value = true;
    viewport.value?.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onPointerMove(e: PointerEvent) {
    const rect = viewport.value?.getBoundingClientRect();
    if (rect) {
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.inside = true;
    }
    if (!grab) return;
    if (!grab.started) {
      if (Math.hypot(e.clientX - grab.x, e.clientY - grab.y) < DRAG_START_PX) return;
      grab.started = true;
      begin(e);
    }
    panByScreen(grab.x - e.clientX, grab.y - e.clientY);
    grab.x = e.clientX;
    grab.y = e.clientY;
  }
  function onPointerUp() {
    grab = null;
    panning.value = false;
  }
  function onPointerLeave() {
    pointer.inside = false;
  }

  // --- keys + edge scroll, one frame loop ---------------------------------------------
  const held = new Set<string>();
  let raf = 0;
  let last = 0;

  function typingTarget(t: EventTarget | null) {
    const el = t as HTMLElement | null;
    return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
  }
  function onKeyDown(e: KeyboardEvent) {
    if (typingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k in PAN_KEYS) {
      held.add(k);
      e.preventDefault();
    } else if (k === "home" || k === " ") {
      recenter();
      e.preventDefault();
    } else if (k === "=" || k === "+") zoomTo(zoom.value * 1.2);
    else if (k === "-" || k === "_") zoomTo(zoom.value / 1.2);
  }
  const clearHeld = () => held.clear();
  function onKeyUp(e: KeyboardEvent) {
    held.delete(e.key.toLowerCase());
  }

  function frame(t: number) {
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    let vx = 0;
    let vy = 0;
    for (const k of held) {
      vx += PAN_KEYS[k]?.[0] ?? 0;
      vy += PAN_KEYS[k]?.[1] ?? 0;
    }
    const { w, h } = size();
    if (!panning.value && edgeScroll() && pointer.inside && w && h) {
      // Ramps up the closer the cursor gets to the edge.
      if (pointer.x < EDGE_ZONE_PX) vx -= 1 - pointer.x / EDGE_ZONE_PX;
      else if (pointer.x > w - EDGE_ZONE_PX) vx += 1 - (w - pointer.x) / EDGE_ZONE_PX;
      if (pointer.y < EDGE_ZONE_PX) vy -= 1 - pointer.y / EDGE_ZONE_PX;
      else if (pointer.y > h - EDGE_ZONE_PX) vy += 1 - (h - pointer.y) / EDGE_ZONE_PX;
    }
    if (vx || vy) {
      const len = Math.max(1, Math.hypot(vx, vy));
      panByScreen((vx / len) * PAN_SPEED_PX_S * dt, (vy / len) * PAN_SPEED_PX_S * dt);
    }
    raf = requestAnimationFrame(frame);
  }

  onMounted(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearHeld);
    raf = requestAnimationFrame(frame);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", clearHeld);
    cancelAnimationFrame(raf);
  });

  return {
    cam,
    zoom,
    panning,
    recenter,
    zoomTo,
    handlers: { onWheel, onPointerDown, onPointerMove, onPointerUp, onPointerLeave },
  };
}
