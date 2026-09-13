import { BASE, MAX_PIXELS } from "../tuning";
import { max, min, round, sqrt } from "./system";

const DPR_CAP = 2;

/** CSS pixels per logical pixel. Recomputed on every resize. */
let scale = 1;
/**
 * Device pixels per CSS pixel, capped both by DPR_CAP and by MAX_PIXELS.
 *
 * Multiplied by `scale` in `getScale()` to give device pixels per *logical* pixel, which is what
 * the beam shader needs to size its minimum width and its anti-aliased edge.
 */
let dpr = 1;

/** Logical viewport size — the short side is pinned at BASE, the long side follows the real aspect ratio. */
let vw = BASE;
let vh = BASE;

let gl: WebGLRenderingContext;
/** True when the context is really a WebGL2 one — the bloom pipeline needs it for RGBA16F targets. */
let gl2 = false;

/** True on any touch-capable device — a fixed device capability, not something that changes with viewport size. */
export const isTouch = navigator.maxTouchPoints > 0;
/** Mobile form factor, kept separate from touch so convertible laptops are not orientation-locked. */
export const isMobile = /Mobi|Android|iP/.test(navigator.userAgent);
/** Whether the player is currently playing by touch. `isTouch` only says the hardware can, and a
 *  touchscreen laptop played on its keyboard must not be shown tap prompts — so the prompts follow
 *  the last input that was actually used. Starts at `isMobile`, because a phone has no other way in. */
export let touchUI = isMobile;
export const setTouchUI = (v: boolean): void => {
  touchUI = v;
};

/** Backing-store size in device pixels. The bloom render targets are sized from this. */
export const canvasW = (): number => c.width;
export const canvasH = (): number => c.height;

/** Current logical viewport size — the short side is BASE, the long side follows the real aspect ratio. */
export const viewW = (): number => vw;
export const viewH = (): number => vh;

/** Device pixels per logical pixel — `scale * dpr`. Used to floor the on-screen beam width and size its AA edge. */
export const getScale = (): number => scale * dpr;

/** Converts a client-space point (pointer event coordinates) to logical canvas space. */
export const toLogicalX = (clientX: number): number => clientX / scale;
export const toLogicalY = (clientY: number): number => clientY / scale;

/** Whether `initViewport` managed to get a WebGL2 context (see gfx/bloom.ts). */
export const isGL2 = (): boolean => gl2;

const resizeCbs: (() => void)[] = [];
const restoreCbs: (() => void)[] = [];

/** Fired after every resize, so render targets that track the backing store can be rebuilt. */
export const onResize = (cb: () => void): void => {
  resizeCbs.push(cb);
};

/**
 * Fired after a lost context comes back. Windows GPU driver resets (TDR) are common enough that
 * silently leaving the canvas black is a real failure mode; game state itself is untouched, so
 * play resumes in place.
 */
export const onRestore = (cb: () => void): void => {
  restoreCbs.push(cb);
};

const resize = (): void => {
  const iw = innerWidth;
  const ih = innerHeight;

  // Short side pinned at BASE: a 16:9 desktop gets 960x540 and a portrait phone gets a tall field
  // instead of a squashed-flat one, and every authored size — text, HUD offsets, glyph radii —
  // keeps its intended apparent scale on any device instead of shrinking with the pixel count.
  if (ih >= iw) {
    vw = BASE;
    vh = (BASE * ih) / iw;
  } else {
    vh = BASE;
    vw = (BASE * iw) / ih;
  }
  scale = iw / vw; // === ih / vh, aspect is preserved exactly

  // The backing store is capped by a pixel budget rather than just DPR: a high-DPR phone would
  // otherwise push 3+ Mpx of overdraw through the glow shader every frame for no visible benefit
  // at arm's length.
  dpr = min(DPR_CAP, max(1, sqrt(MAX_PIXELS / (iw * ih))));

  // The canvas fills the viewport exactly — no letterbox bars, so the client -> logical mapping in
  // toLogicalX/Y needs no origin offset.
  c.style.width = `${iw}px`;
  c.style.height = `${ih}px`;
  c.width = round(iw * dpr);
  c.height = round(ih * dpr);
  gl.viewport(0, 0, c.width, c.height);
  for (const cb of resizeCbs) cb();
};

export const initViewport = (): WebGLRenderingContext => {
  // Keys are quoted on purpose: Terser's property mangler runs with no regex filter, and
  // `keep_quoted: true` is the only guaranteed escape hatch for an object literal handed to a
  // Web API.
  //
  // WebGL2 first: the bloom pipeline (gfx/bloom.ts) wants RGBA16F render targets, which WebGL1 can
  // only reach through half-float extensions. Every shader here is still GLSL ES 1.00 — a WebGL2
  // context accepts those unchanged as long as no `#version 300 es` is used — so this is purely
  // about which texture formats are renderable, not a port to GLSL 3.
  const attrs = {
    "alpha": false,
    "antialias": false,
    "depth": false,
    "stencil": false,
    "premultipliedAlpha": false,
    "powerPreference": "high-performance",
  };

  const ctx2 = c.getContext("webgl2", attrs);
  gl2 = !!ctx2;
  gl = (ctx2 ?? c.getContext("webgl", attrs)) as WebGLRenderingContext;

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  // Plain additive: the beam shader outputs premultiplied emission, and additive accumulation is
  // what makes overlapping emitters brighten each other.
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 1);

  c.addEventListener("webglcontextlost", (e) => e.preventDefault());
  c.addEventListener("webglcontextrestored", () => {
    for (const cb of restoreCbs) cb();
  });

  addEventListener("resize", resize);
  // Android reports stale innerWidth/innerHeight if read synchronously inside the
  // orientationchange handler itself — one rAF later they're settled.
  addEventListener("orientationchange", () => requestAnimationFrame(resize));
  resize();

  return gl;
};
