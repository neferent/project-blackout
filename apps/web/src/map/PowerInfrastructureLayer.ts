import maplibregl from "maplibre-gl";
import type { CustomLayerInterface, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LatLng, PowerInfrastructureInViewportResponse } from "@blackout/shared";
import { registerMapLayer } from "./layerRegistry.js";

const TOWER_SOURCE_ID = "power-towers";
const LINE_LAYER_ID = "power-lines-line";
const TOWER_LAYER_ID = "power-towers-point";

/** How high above ground the wire floats — plausible against nearby building extrusion heights (style.ts). */
const WIRE_HEIGHT_METERS = 25;
const WIRE_COLOR: [number, number, number, number] = [0.788, 0.647, 0.231, 0.9]; // #c9a53b

const VERTEX_SHADER = `
  attribute vec3 a_pos;
  uniform mat4 u_matrix;
  void main() {
    gl_Position = u_matrix * vec4(a_pos, 1.0);
  }
`;
const FRAGMENT_SHADER = `
  precision mediump float;
  uniform vec4 u_color;
  void main() {
    gl_FragColor = u_color;
  }
`;

interface PowerLineLayer extends CustomLayerInterface {
  setLines(lines: LatLng[][]): void;
}

/**
 * Earlier attempt buffered each line into a thin fill-extrusion polygon ribbon
 * floating above ground — looked right at first, but on inspection it renders
 * as an intermittent dashed pattern (likely GeoJSON-vt tile quantization
 * collapsing alternating thin polygons to zero area) and whole stretches
 * vanish after panning away and back as tiles get rebuilt. A real line
 * primitive, drawn ourselves from the raw points every frame, has no such
 * degenerate case — hence a custom WebGL layer instead of a style layer.
 * Trade-off: GL line width is capped at ~1px on most GPUs (WebGL spec allows
 * but doesn't require wider lines), so this reads as a thin wire, not a
 * ribbon — see CLAUDE.md if a thicker line is wanted later (would need
 * camera-facing billboard quads instead of GL_LINES).
 */
function createPowerLineLayer(id: string): PowerLineLayer {
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let vertexCount = 0;
  let aPos = -1;
  let uMatrix: WebGLUniformLocation | null = null;
  let uColor: WebGLUniformLocation | null = null;
  let pendingLines: LatLng[][] | null = null;

  function compileShader(glc: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = glc.createShader(type);
    if (!shader) throw new Error("Failed to create shader");
    glc.shaderSource(shader, source);
    glc.compileShader(shader);
    if (!glc.getShaderParameter(shader, glc.COMPILE_STATUS)) {
      const info = glc.getShaderInfoLog(shader);
      glc.deleteShader(shader);
      throw new Error(`Shader compile failed: ${info}`);
    }
    return shader;
  }

  function upload(glc: WebGLRenderingContext | WebGL2RenderingContext, lines: LatLng[][]) {
    // GL_LINES (not LINE_STRIP) so unrelated lines/segments never connect to each
    // other — each segment is its own independent pair of vertices.
    const positions: number[] = [];
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = maplibregl.MercatorCoordinate.fromLngLat(line[i], WIRE_HEIGHT_METERS);
        const b = maplibregl.MercatorCoordinate.fromLngLat(line[i + 1], WIRE_HEIGHT_METERS);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    vertexCount = positions.length / 3;
    glc.bindBuffer(glc.ARRAY_BUFFER, buffer);
    glc.bufferData(glc.ARRAY_BUFFER, new Float32Array(positions), glc.DYNAMIC_DRAW);
  }

  return {
    id,
    type: "custom",
    renderingMode: "3d",
    onAdd(_map, glc) {
      gl = glc;
      const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      const prog = gl.createProgram();
      if (!prog) throw new Error("Failed to create program");
      gl.attachShader(prog, vertexShader);
      gl.attachShader(prog, fragmentShader);
      gl.linkProgram(prog);
      program = prog;
      aPos = gl.getAttribLocation(prog, "a_pos");
      uMatrix = gl.getUniformLocation(prog, "u_matrix");
      uColor = gl.getUniformLocation(prog, "u_color");
      buffer = gl.createBuffer();

      if (pendingLines) {
        upload(gl, pendingLines);
        pendingLines = null;
      }
    },
    render(glc, matrix) {
      if (!program || !buffer || vertexCount === 0) return;
      glc.useProgram(program);
      glc.enableVertexAttribArray(aPos);
      glc.bindBuffer(glc.ARRAY_BUFFER, buffer);
      glc.vertexAttribPointer(aPos, 3, glc.FLOAT, false, 0, 0);
      glc.uniformMatrix4fv(uMatrix, false, matrix);
      glc.uniform4fv(uColor, WIRE_COLOR);
      glc.drawArrays(glc.LINES, 0, vertexCount);
      // MapLibre reuses this GL context for every other layer in the same frame and doesn't
      // reset state between them — leaving this attribute array enabled corrupted every
      // layer drawn after this one (silently: no JS exception, the whole map just went black).
      glc.disableVertexAttribArray(aPos);
      glc.bindBuffer(glc.ARRAY_BUFFER, null);
      glc.useProgram(null);
    },
    setLines(lines) {
      if (gl) {
        upload(gl, lines);
      } else {
        pendingLines = lines;
      }
    },
  };
}

const powerLineLayers = new WeakMap<MapLibreMap, PowerLineLayer>();

/** Registers the (initially empty) sources/layers for major transmission lines and towers. */
export function ensurePowerInfrastructureLayer(map: MapLibreMap): void {
  if (map.getSource(TOWER_SOURCE_ID)) return;

  map.addSource(TOWER_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  const lineLayer = createPowerLineLayer(LINE_LAYER_ID);
  powerLineLayers.set(map, lineLayer);
  registerMapLayer(map, "overlay-over-buildings", lineLayer as unknown as never);

  registerMapLayer(map, "overlay-over-buildings", {
    id: TOWER_LAYER_ID,
    type: "circle",
    source: TOWER_SOURCE_ID,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 17, 5],
      "circle-color": "#c9a53b",
      "circle-stroke-color": "#0b0c0d",
      "circle-stroke-width": 1,
    },
  });
}

/** Replaces the rendered lines/towers with the given viewport query result. */
export function setPowerInfrastructure(map: MapLibreMap, data: PowerInfrastructureInViewportResponse): void {
  powerLineLayers.get(map)?.setLines(data.lines);

  const towerSource = map.getSource(TOWER_SOURCE_ID);
  if (towerSource?.type === "geojson") {
    (towerSource as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: data.towers.map((tower) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [tower.lng, tower.lat] },
        properties: {},
      })),
    });
  }
}
