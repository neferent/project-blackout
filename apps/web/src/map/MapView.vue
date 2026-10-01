<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from "vue";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  buildDistortedMapStyle,
  buildMapStyle,
  DISTORTED_PATH_OPACITY,
  MAIN_PATH_OPACITY,
  ROAD_MAJOR_GLOW_OPACITY,
  ROAD_MINOR_GLOW_OPACITY,
} from "./style.js";
import {
  createCrackedEarthImage,
  createGroundNoiseImage,
  createRoofDebrisImage,
  createWaterRippleImage,
} from "./noisePattern.js";
import { config } from "../config.js";
import { useMapStore } from "../stores/mapStore.js";
import { ensurePowerInfrastructureLayer, setPowerInfrastructure } from "./PowerInfrastructureLayer.js";
import { fetchAllPowerPlants, fetchAllSubstations, fetchPowerInfrastructureInViewport } from "../geo/infrastructure.js";
import { ensureHexGridLayer, ensureHexHighlightGroup } from "./HexGridLayer.js";

const mapStore = useMapStore();
const containerRef = useTemplateRef<HTMLDivElement>("container");
const distortContainerRef = useTemplateRef<HTMLDivElement>("distortContainer");
const chromaticOverlayRef = useTemplateRef<HTMLCanvasElement>("chromaticOverlay");
const weatherOverlayRef = useTemplateRef<HTMLCanvasElement>("weatherOverlay");

let distortMap: maplibregl.Map | null = null;
let glowFlickerTimeout: ReturnType<typeof setTimeout> | null = null;
let weatherAnimationFrame: number | null = null;
let stopWeatherResize: (() => void) | null = null;
let powerInfraMoveEndHandler: (() => void) | null = null;

interface AshParticle {
  x: number;
  y: number;
  vy: number;
  size: number;
  alpha: number;
  drift: number;
  driftPhase: number;
  rotation: number;
  rotationSpeed: number;
  // Kicked by mouse-drag deltas (see startWeatherParticles) and decayed each frame — a brief
  // gust rather than a permanent velocity change. Separate from vy (the constant fall speed)
  // so dragging doesn't need to fight against gravity to feel responsive.
  impulseVx: number;
  impulseVy: number;
  // Precomputed once per particle (not regenerated per frame, or it would flicker) — offsets
  // in [-1, 1]-ish units, scaled by `size` at draw time.
  shape: Array<[number, number]>;
}

/** A random irregular polygon (6-9 vertices, jittered radius) instead of a perfect circle. */
function makeJaggedShape(): Array<[number, number]> {
  const vertexCount = 6 + Math.floor(Math.random() * 4);
  return Array.from({ length: vertexCount }, (_, i) => {
    const angle = (i / vertexCount) * Math.PI * 2;
    const radius = 0.5 + Math.random() * 0.7;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

/** Falling ash/dust: a small self-contained canvas particle loop, independent of MapLibre. */
function startWeatherParticles(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const particleCount = 35;
  let particles: AshParticle[] = [];

  function makeParticle(randomizeY: boolean): AshParticle {
    return {
      x: Math.random() * canvas.width,
      y: randomizeY ? Math.random() * canvas.height : -4,
      vy: 3 + Math.random() * 7,
      size: 4 + Math.random() * 5,
      alpha: 0.04 + Math.random() * 0.1,
      drift: 6 + Math.random() * 14,
      driftPhase: Math.random() * Math.PI * 2,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.6,
      impulseVx: 0,
      impulseVy: 0,
      shape: makeJaggedShape(),
    };
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    particles = Array.from({ length: particleCount }, () => makeParticle(true));
  }
  resize();
  window.addEventListener("resize", resize);

  // Dragging the mouse kicks the particles' impulse velocity in the direction of the drag —
  // doesn't need to sync with the map at all, it's just a reactive gust. Listened on window
  // rather than the canvas since the canvas has pointer-events: none (clicks must still reach
  // the map underneath).
  let isPointerDown = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  const dpr = () => window.devicePixelRatio || 1;
  function onPointerDown(event: PointerEvent) {
    isPointerDown = true;
    lastPointerX = event.clientX * dpr();
    lastPointerY = event.clientY * dpr();
  }
  function onPointerMove(event: PointerEvent) {
    if (!isPointerDown) return;
    const x = event.clientX * dpr();
    const y = event.clientY * dpr();
    const dx = x - lastPointerX;
    const dy = y - lastPointerY;
    lastPointerX = x;
    lastPointerY = y;
    const kick = 0.9;
    for (const particle of particles) {
      particle.impulseVx += dx * kick;
      particle.impulseVy += dy * kick;
    }
  }
  function onPointerUp() {
    isPointerDown = false;
  }
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  let lastTime = performance.now();
  const tick = () => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(200, 200, 190, 1)";
    // Frame-rate-independent exponential decay, so the gust fades at the same real-world
    // rate regardless of dt.
    const impulseDecay = Math.exp(-3 * dt);
    for (const particle of particles) {
      particle.impulseVx *= impulseDecay;
      particle.impulseVy *= impulseDecay;
      particle.x += particle.impulseVx * dt;
      particle.y += (particle.vy + particle.impulseVy) * dt;
      particle.driftPhase += dt;
      particle.rotation += particle.rotationSpeed * dt;
      const x = particle.x + Math.sin(particle.driftPhase) * particle.drift;
      if (particle.y > canvas.height + 4) {
        Object.assign(particle, makeParticle(false));
        continue;
      }
      ctx.globalAlpha = particle.alpha;
      ctx.beginPath();
      const [firstDx, firstDy] = particle.shape[0];
      const cos = Math.cos(particle.rotation);
      const sin = Math.sin(particle.rotation);
      const toScreen = (dx: number, dy: number): [number, number] => [
        x + (dx * cos - dy * sin) * particle.size,
        particle.y + (dx * sin + dy * cos) * particle.size,
      ];
      const [startX, startY] = toScreen(firstDx, firstDy);
      ctx.moveTo(startX, startY);
      for (let i = 1; i < particle.shape.length; i++) {
        const [dx, dy] = particle.shape[i];
        const [px, py] = toScreen(dx, dy);
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    weatherAnimationFrame = requestAnimationFrame(tick);
  };
  weatherAnimationFrame = requestAnimationFrame(tick);

  return () => {
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };
}

/** Sets both glow layers' opacity to the given fraction of their base value, if loaded. */
function applyGlowFlicker(targetMap: maplibregl.Map | null, pathOpacity: number, factor: number) {
  if (!targetMap?.getLayer("road-minor-glow")) return;
  targetMap.setPaintProperty("road-minor-glow", "line-opacity", ROAD_MINOR_GLOW_OPACITY * pathOpacity * factor);
  targetMap.setPaintProperty("road-major-glow", "line-opacity", ROAD_MAJOR_GLOW_OPACITY * pathOpacity * factor);
}

onMounted(() => {
  const el = containerRef.value;
  const distortEl = distortContainerRef.value;
  if (!el || !distortEl) return;

  const initialView = {
    center: [config.defaultCenter.lng, config.defaultCenter.lat] as [number, number],
    zoom: 14,
    pitch: 45,
  };

  const map = new maplibregl.Map({
    container: el,
    style: buildMapStyle(config.tileSourceUrl, config.glyphsUrl),
    ...initialView,
    maxPitch: 70,
    attributionControl: { compact: true },
    // Needed so the rendered frame is still readable by drawImage() below when mirroring it
    // into the chromatic-aberration overlay canvas — otherwise the buffer may already be
    // cleared by the time we read it.
    preserveDrawingBuffer: true,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
  // Each Map instance has its own image registry, so the "ground-noise-pattern" the style's
  // background layer references (see style.ts) has to be registered here per-instance.
  map.on("style.load", () => {
    map.addImage("ground-noise-pattern", createGroundNoiseImage());
    map.addImage("water-ripple-pattern", createWaterRippleImage());
    map.addImage("roof-debris-pattern", createRoofDebrisImage());
    map.addImage("cracked-earth-pattern", createCrackedEarthImage());
  });
  // Publish only once the style has finished loading — consumers add
  // sources/layers as soon as they see mapStore.map, and MapLibre throws if
  // that happens before the style is ready.
  map.once("load", () => mapStore.setMap(map));

  // Preview only: what the H3_RESOLUTION grid looks like over the real map. Not wired into
  // any game mechanic — see HexGridLayer.ts.
  map.once("load", () => {
    ensureHexGridLayer(map);
    // Debug probe: highlight the hex every BC power source falls in (substations in red,
    // plants in orange — 732 + 120 rows, small enough to fetch and highlight all at once,
    // no viewport filtering).
    const substationHighlight = ensureHexHighlightGroup(map, "hex-grid-substations", "#ff3f3f");
    void fetchAllSubstations().then((substations) => substationHighlight.setPoints(map, substations));

    const plantHighlight = ensureHexHighlightGroup(map, "hex-grid-plants", "#ff9f3f");
    void fetchAllPowerPlants().then((plants) => plantHighlight.setPoints(map, plants));
  });

  // Major transmission power lines/towers, pulled from Overpass for whatever's currently in
  // view — visualization only, no persistence, so a live "moveend" re-query (same debounce
  // pattern as danger zones in TravelPanel.vue) is enough.
  // Disabled for now (rendering wasn't good enough — see PowerInfrastructureLayer.ts for the
  // history of attempts). Code kept in place rather than deleted.
  let powerInfraRequestId = 0;
  const POWER_GRID_RENDERING_ENABLED = false;
  map.once("load", () => {
    if (!POWER_GRID_RENDERING_ENABLED) return;
    try {
      ensurePowerInfrastructureLayer(map);
    } catch (err) {
      console.error("ensurePowerInfrastructureLayer failed", err);
    }
    const loadPowerInfrastructure = async () => {
      const requestId = ++powerInfraRequestId;
      const bounds = map.getBounds();
      // On failure (including the API's 503 for a timed-out/failed Overpass query — see
      // queryOverpassPowerInfrastructure), leave the previously-rendered lines/towers alone
      // rather than clearing them: a transient failure on a big/fast pan shouldn't blank out
      // data that's still a reasonable approximation of what's currently in view.
      const data = await fetchPowerInfrastructureInViewport({
        minLat: bounds.getSouth(),
        minLng: bounds.getWest(),
        maxLat: bounds.getNorth(),
        maxLng: bounds.getEast(),
      }).catch(() => null);
      if (requestId !== powerInfraRequestId || data === null) return;
      setPowerInfrastructure(map, data);
    };
    powerInfraMoveEndHandler = () => void loadPowerInfrastructure();
    map.on("moveend", powerInfraMoveEndHandler);
    void loadPowerInfrastructure();
  });

  // Chromatic-aberration overlay: a live mirror of the primary map canvas (unlike the
  // distorted map, this needs identical content, just different post-processing, so a
  // pixel copy is the right tool here rather than a second MapLibre instance). The
  // "chromatic-aberration" filter is applied via CSS, and a radial CSS mask fades it out
  // toward the center so the fringing only shows near the viewport edges, like a lens
  // artifact, while the crisp base map shows through unaltered in the middle.
  const chromaticOverlay = chromaticOverlayRef.value;
  const chromaticCtx = chromaticOverlay?.getContext("2d") ?? null;

  function resizeChromaticOverlay() {
    if (!chromaticOverlay) return;
    const dpr = window.devicePixelRatio || 1;
    chromaticOverlay.width = el.clientWidth * dpr;
    chromaticOverlay.height = el.clientHeight * dpr;
  }
  resizeChromaticOverlay();
  map.on("resize", resizeChromaticOverlay);

  // "render" fires synchronously right after MapLibre draws each frame, so the source
  // canvas still holds this frame's pixels when we copy it.
  map.on("render", () => {
    if (!chromaticOverlay || !chromaticCtx) return;
    chromaticCtx.clearRect(0, 0, chromaticOverlay.width, chromaticOverlay.height);
    chromaticCtx.drawImage(map.getCanvas(), 0, 0, chromaticOverlay.width, chromaticOverlay.height);
  });

  // Second, non-interactive MapLibre instance rendering a reduced style (no labels, faded
  // roads — see buildDistortedMapStyle), camera-synced to the primary map and shown through
  // the CSS distortion filter (applied to its container below). This has to be a real
  // second render rather than a screen-space copy of the primary canvas, since it needs to
  // show different content (no labels/paths), not just a warped copy of the same pixels.
  // Trade-off: doubles vector-tile fetches and GPU/memory cost versus a pixel-copy overlay.
  distortMap = new maplibregl.Map({
    container: distortEl,
    style: buildDistortedMapStyle(config.tileSourceUrl, config.glyphsUrl),
    ...initialView,
    maxPitch: 70,
    attributionControl: false,
    interactive: false,
  });
  distortMap.on("style.load", () => {
    distortMap?.addImage("ground-noise-pattern", createGroundNoiseImage());
    distortMap?.addImage("water-ripple-pattern", createWaterRippleImage());
    distortMap?.addImage("roof-debris-pattern", createRoofDebrisImage());
    distortMap?.addImage("cracked-earth-pattern", createCrackedEarthImage());
  });
  map.on("move", () => {
    distortMap?.jumpTo({
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    });
  });

  // Irregular flicker on the path glow (like a failing light), applied in sync to both maps
  // so it reads as one in-world light source rather than two independent effects.
  const scheduleGlowFlicker = () => {
    glowFlickerTimeout = setTimeout(
      () => {
        const factor = 0.7 + Math.random() * 0.3;
        applyGlowFlicker(map, MAIN_PATH_OPACITY, factor);
        applyGlowFlicker(distortMap, DISTORTED_PATH_OPACITY, factor);
        scheduleGlowFlicker();
      },
      2000 + Math.random() * 4000,
    );
  };
  scheduleGlowFlicker();

  const weatherOverlay = weatherOverlayRef.value;
  if (weatherOverlay) stopWeatherResize = startWeatherParticles(weatherOverlay) ?? null;
});

onUnmounted(() => {
  if (glowFlickerTimeout !== null) clearTimeout(glowFlickerTimeout);
  if (weatherAnimationFrame !== null) cancelAnimationFrame(weatherAnimationFrame);
  stopWeatherResize?.();
  if (powerInfraMoveEndHandler && mapStore.map) mapStore.map.off("moveend", powerInfraMoveEndHandler);
  mapStore.map?.remove();
  mapStore.setMap(null);
  distortMap?.remove();
  distortMap = null;
});
</script>

<template>
  <svg class="distortion-defs" aria-hidden="true" focusable="false">
    <filter
      id="map-distortion"
      x="-20%"
      y="-20%"
      width="140%"
      height="140%"
      color-interpolation-filters="sRGB"
    >
      <!-- baseFrequency needs to be high enough that noise varies within a short distance, or edges just
           shift uniformly instead of bending. type="turbulence" (vs fractalNoise) gives a more angular,
           chaotic field to start from. -->
      <feTurbulence type="turbulence" baseFrequency="0.015 0.02" numOctaves="4" seed="7" result="warpNoiseRaw" />
      <!-- Quantize into discrete steps so the displacement jumps between levels instead of flowing
           smoothly — that's what reads as jagged/cracked rather than wavy. -->
      <feComponentTransfer in="warpNoiseRaw" result="warpNoise">
        <feFuncR type="discrete" tableValues="0 0.25 0.5 0.75 1" />
        <feFuncG type="discrete" tableValues="0 0.25 0.5 0.75 1" />
      </feComponentTransfer>
      <!-- scale is the max pixel displacement. -->
      <feDisplacementMap in="SourceGraphic" in2="warpNoise" scale="10" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <!-- Isolates each color channel, offsets red/blue in opposite directions, and recombines
         via screen blending — the classic lens chromatic-aberration look. Where a CSS mask
         (see .chromatic-overlay) hides the effect, none of this matters. -->
    <filter id="chromatic-aberration" color-interpolation-filters="sRGB">
      <feColorMatrix
        in="SourceGraphic"
        type="matrix"
        values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
        result="red"
      />
      <feOffset in="red" dx="6" dy="0" result="redOffset" />
      <feColorMatrix
        in="SourceGraphic"
        type="matrix"
        values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
        result="green"
      />
      <feColorMatrix
        in="SourceGraphic"
        type="matrix"
        values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
        result="blue"
      />
      <feOffset in="blue" dx="-6" dy="0" result="blueOffset" />
      <feBlend in="redOffset" in2="green" mode="screen" result="redGreen" />
      <feBlend in="redGreen" in2="blueOffset" mode="screen" />
    </filter>
  </svg>
  <div ref="container" class="map-container"></div>
  <div ref="distortContainer" class="distort-container" aria-hidden="true"></div>
  <canvas ref="chromaticOverlay" class="chromatic-overlay" aria-hidden="true"></canvas>
  <div class="ambience-tint" aria-hidden="true"></div>
  <div class="ambience-vignette" aria-hidden="true"></div>
  <div class="ambience-grain" aria-hidden="true"></div>
  <canvas ref="weatherOverlay" class="weather-overlay" aria-hidden="true"></canvas>
</template>

<style scoped>
.distortion-defs {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}

.map-container {
  position: fixed;
  inset: 0;
  background: #0b0c0d;
  filter: saturate(0.75) contrast(1.05);
}

/* Second map (no labels, faded roads — see style.ts), warped by the distortion filter and
   blended back over the clean map. mix-blend-mode/opacity control how strongly the
   "glitched double" reads through — screen+~0.5 gives a ghosted overlap; try "difference"
   for a harsher, more corrupted-signal look. */
.distort-container {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  filter: url(#map-distortion) saturate(0.75) contrast(1.05);
  opacity: 0.5;
  mix-blend-mode: screen;
}

/* Sickly color cast. Swap --tint-color to rgba(90, 60, 120, 0.16) for a
   purple/irradiated read instead of green/toxic. */
.ambience-tint {
  --tint-color: rgba(60, 100, 70, 0.16);
  position: fixed;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background: var(--tint-color);
  mix-blend-mode: color;
}

/* Live mirror of the primary map canvas (see script), run through the chromatic-aberration
   filter. The mask fades it to transparent toward the center so the crisp base map shows
   through unaltered there, and only the edges show the color-fringed copy — like a lens
   artifact rather than a whole-screen effect. -webkit- prefix needed for Safari. */
.chromatic-overlay {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 3;
  pointer-events: none;
  filter: url(#chromatic-aberration);
  -webkit-mask-image: radial-gradient(ellipse at center, transparent 55%, black 100%);
  mask-image: radial-gradient(ellipse at center, transparent 55%, black 100%);
}

/* Darkens toward the edges so the map reads like a torch-lit patch of a
   dead world rather than an evenly lit UI canvas. */
.ambience-vignette {
  position: fixed;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  background: radial-gradient(
    ellipse at center,
    rgba(0, 0, 0, 0) 65%,
    rgba(6, 8, 6, 0.22) 90%,
    rgba(4, 5, 4, 0.4) 100%
  );
}

/* Faint noise for a dirty, degraded broadcast feel. */
.ambience-grain {
  position: fixed;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  opacity: 0.06;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* Falling ash/dust, drawn by a self-contained canvas particle loop (see script) — not tied
   to MapLibre, so it doesn't pan/zoom with the map, it just drifts over the whole viewport. */
.weather-overlay {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 6;
  pointer-events: none;
  filter: blur(1px);
  opacity: 0.6;
}
</style>
