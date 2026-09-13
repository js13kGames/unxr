// The beam batch. Every segment (arena web, enemy glyphs, shots, font strokes) goes through
// `seg()`; `flush()` uploads and draws them all in one call as sharp cores, and `endFrame()` draws
// the same batch a second time into the glow source before blurring and compositing it (bloom.ts).

import { getScale, onRestore, viewH, viewW } from "../core/viewport";
import { bindGlowSource, bindScene, initBloom, post } from "./bloom";
import { buildFS, buildVS, link } from "./gl";
import { glowScale, sourceGain } from "./tune";

const MAX_SEGMENTS = 2048;
const FLOATS_PER_VERT = 6; // aA.xy, aB.xy, aC (packed), aW
const VERTS_PER_SEG = 4;
const STRIDE = FLOATS_PER_VERT * 4;

let gl: WebGLRenderingContext;
let vbo: WebGLBuffer;
let ibo: WebGLBuffer;
let cornerVbo: WebGLBuffer;
let uP: WebGLUniformLocation | null;
let uM: WebGLUniformLocation | null;
let uG: WebGLUniformLocation | null;
let uA: WebGLUniformLocation | null;
let program: WebGLProgram;

// One backing ArrayBuffer, two aliased views: floats for position/width, a uint32 view so the
// packed colour can be written without float round-tripping.
const raw = new ArrayBuffer(MAX_SEGMENTS * VERTS_PER_SEG * STRIDE);
const f32 = new Float32Array(raw);
const u32 = new Uint32Array(raw);

let count = 0;

/**
 * Glow bands: how much of the blur each stretch of the batch feeds.
 *
 * The draw order already says what a mark is — the arena first, gameplay over it, HUD last — so a
 * band is just a segment index and a gain, and the glow pass replays sub-ranges of the same index
 * buffer at different gains. No per-vertex attribute, no second batch, and callers say what a
 * thing *is* rather than knowing how the glow pipeline works.
 *
 * Safe to declare anywhere, because blending is plain additive and therefore commutative: a band
 * changes what feeds the blur, never the order anything is drawn in.
 */
const bandAt: number[] = [];
const bandGain: number[] = [];
let curGain = 1;

/**
 * Compiles and links the beam program and (re)binds the vertex attributes against the existing
 * buffers. Split out from buffer creation so a debug build's `dev/gui.ts` can relink after a
 * shader-baked `tune.ts` value changes (`rebuildBeam`) without recreating GPU buffers or losing
 * their data — only a fresh program's attribute locations need rebinding.
 */
const setupProgram = (): void => {
  program = link(gl, buildVS(), buildFS());
  gl.useProgram(program);

  const locA = gl.getAttribLocation(program, "aA");
  const locB = gl.getAttribLocation(program, "aB");
  const locK = gl.getAttribLocation(program, "aK");
  const locC = gl.getAttribLocation(program, "aC");
  const locW = gl.getAttribLocation(program, "aW");
  uP = gl.getUniformLocation(program, "uP");
  uM = gl.getUniformLocation(program, "uM");
  uG = gl.getUniformLocation(program, "uG");
  uA = gl.getUniformLocation(program, "uA");

  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(locA);
  gl.vertexAttribPointer(locA, 2, gl.FLOAT, false, STRIDE, 0);
  gl.enableVertexAttribArray(locB);
  gl.vertexAttribPointer(locB, 2, gl.FLOAT, false, STRIDE, 8);
  gl.enableVertexAttribArray(locC);
  gl.vertexAttribPointer(locC, 4, gl.UNSIGNED_BYTE, true, STRIDE, 16);
  gl.enableVertexAttribArray(locW);
  gl.vertexAttribPointer(locW, 1, gl.FLOAT, false, STRIDE, 20);

  // Static per-vertex corner index (0..3), one float per vertex, never rewritten.
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerVbo);
  gl.enableVertexAttribArray(locK);
  gl.vertexAttribPointer(locK, 1, gl.FLOAT, false, 0, 0);
};

const createBuffers = (): void => {
  vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, raw.byteLength, gl.DYNAMIC_DRAW);

  cornerVbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerVbo);
  const corners = new Float32Array(MAX_SEGMENTS * VERTS_PER_SEG);
  for (let i = 0; i < corners.length; i++) corners[i] = i % 4;
  gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);

  // Static index buffer: two triangles per segment, [0,1,2, 2,1,3].
  ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  const indices = new Uint16Array(MAX_SEGMENTS * 6);
  for (let i = 0; i < MAX_SEGMENTS; i++) {
    const v = i * 4;
    const o = i * 6;
    indices[o] = v;
    indices[o + 1] = v + 1;
    indices[o + 2] = v + 2;
    indices[o + 3] = v + 2;
    indices[o + 4] = v + 1;
    indices[o + 5] = v + 3;
  }
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
};

const setup = (): void => {
  createBuffers();
  setupProgram();
};

/** DEBUG-only: recompiles the beam program after `dev/gui.ts` changes a shader-baked `tune.ts`
 *  value. In a release build nothing calls this — `tune.ts`'s getters never change. */
export const rebuildBeam = (): void => {
  if (gl) setupProgram();
};

export const initLines = (context: WebGLRenderingContext): void => {
  gl = context;
  setup();
  onRestore(setup);
  initBloom(context);
};

/** Starts a frame: binds the offscreen scene target, clears it, and resets the batch. */
export const beginFrame = (): void => {
  bindScene();

  gl.useProgram(program);
  // Recomputed every frame instead of wiring a resize callback across the core/gfx boundary — a
  // handful of uniform calls are free next to the draw itself, and the logical viewport can change
  // size (a portrait phone vs. a resized desktop window).
  // Logical px -> clip space, in one multiply-add: x' = x*uP.x + uP.z.
  gl.uniform4f(uP, 2 / viewW(), -2 / viewH(), -1, 1);
  // Minimum core half-width in logical px, so lines never collapse to aliased hairlines on a small
  // screen. This is the floor every element inherits, so raising it thickens the whole picture at
  // once.
  gl.uniform1f(uM, 0.8 / getScale());
  // The core's anti-aliased edge, one device pixel wide in logical units. Sized here rather than
  // with fwidth() in the shader so the WebGL1 fallback needs no derivatives extension.
  gl.uniform1f(uA, 1 / getScale());
  // The screen pass draws every band at full strength; only the glow source is banded.
  gl.uniform1f(uG, 1);
  count = 0;
  bandAt.length = 0;
  bandGain.length = 0;
  curGain = 1;
};

/**
 * Everything drawn from here on feeds the glow at `gain` times the emissive gain, until the next
 * call. `glowBand(0)` excludes it from the blur entirely — it still reaches the screen with its
 * core and its analytic shoulder, so this is exclusion from the bloom, not from the picture.
 */
export const glowBand = (gain: number): void => {
  if (gain === curGain) return;
  bandAt.push(count);
  bandGain.push(curGain);
  curGain = gain;
};

// Capture mode: while `grab` is set, `seg` records its arguments instead of emitting. The one
// consumer is index.ts's death shatter, which replays a dead entity's own draw call to recover the
// exact screen-space segments it was last drawn from, so no shape is described a second time. The
// check is the first statement of `seg`, ahead of the MAX_SEGMENTS guard — behind it, a capture
// taken while the live batch is full would silently come back empty.
let grab: number[] | null = null;
/** Runs `draw` with the batch redirected into a returned flat [x0,y0,x1,y1,col,...] list. Only
 *  ever call this from `update`, never `draw` — an entity's own draw call sets and clears the beam
 *  transform (`gfx/beam.ts` xform/resetXform), and capturing mid-draw would clobber the live one. */
export const capture = (draw: () => void): number[] => {
  const b: number[] = [];
  grab = b;
  draw();
  grab = null;
  return b;
};

/** Emits one glowing beam segment. `col` is a packed colour (see `packRgb`), `w` is half-width in px. */
export const seg = (x0: number, y0: number, x1: number, y1: number, col: number, w: number): void => {
  if (grab) {
    grab.push(x0, y0, x1, y1, col);
    return;
  }
  if (count >= MAX_SEGMENTS) return;
  let o = count * VERTS_PER_SEG * FLOATS_PER_VERT;
  for (let k = 0; k < VERTS_PER_SEG; k++) {
    f32[o] = x0;
    f32[o + 1] = y0;
    f32[o + 2] = x1;
    f32[o + 3] = y1;
    u32[o + 4] = col;
    f32[o + 5] = w;
    o += FLOATS_PER_VERT;
  }
  count++;
};

/** A zero-length segment, rendered as a round glowing blob. */
export const dot = (x: number, y: number, col: number, w: number): void => seg(x, y, x, y, col, w);

/** This frame's segment count so far — the debug overlay's only consumer. */
export const segCount = (): number => count;

// ELEMENT_ARRAY_BUFFER binding is part of global GL state (unlike ARRAY_BUFFER, which only matters
// at vertexAttribPointer time) — `ibo` was bound last in `setup()` and nothing else ever binds an
// element buffer, so it is still current.
export const flush = (): void => {
  if (!count) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, f32.subarray(0, count * VERTS_PER_SEG * FLOATS_PER_VERT));
  gl.drawElements(gl.TRIANGLES, count * 6, gl.UNSIGNED_SHORT, 0);
};

/**
 * Closes the frame: redraws the very same batch into the low-resolution glow source and then blurs
 * and composites it over the scene. The vertex data is already on the GPU from `flush`, so this is
 * one extra draw call per band, not a second upload.
 */
export const endFrame = (): void => {
  bindGlowSource();
  gl.useProgram(program);
  // The AA edge is scaled to this target's texels, but the *width floor* deliberately is not.
  // Inflating it by 1/GLOW_SCALE would make deep geometry relatively fatter in the glow source than
  // on screen, which is exactly how the far end of a tube turns into one blob. A sub-texel hairline
  // still deposits partial coverage, and the blur smooths what is left.
  gl.uniform1f(uM, 0.8 / getScale());
  gl.uniform1f(uA, 1 / (getScale() * glowScale()));

  // Replay the batch once per glow band. The source is driven by explicit emissive gains, never
  // extracted from the scene with a brightness threshold — an explicit emitter list is what
  // guarantees the HUD does not bloom by accident. Bands at zero gain are skipped, not drawn black.
  bandAt.push(count);
  bandGain.push(curGain);
  let from = 0;
  for (let i = 0; i < bandAt.length; i++) {
    const to = bandAt[i]!;
    const g = bandGain[i]! * sourceGain();
    if (to > from && g > 0) {
      gl.uniform1f(uG, g);
      gl.drawElements(gl.TRIANGLES, (to - from) * 6, gl.UNSIGNED_SHORT, from * 6 * 2);
    }
    from = to;
  }

  post();
};

/** Packs 0..255 RGB into the little-endian ABGR uint32 the shader's `aC` attribute expects. */
export const packRgb = (r: number, g: number, b: number, a = 255): number =>
  ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((a & 255) << 24)) >>> 0;
