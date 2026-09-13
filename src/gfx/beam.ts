// Adapter between the game's polyline vocabulary and the GL beam batch in lines.ts.
//
// The game and the vector font both speak "a flat [x0,y0,x1,y1,...] path in this colour, at this
// stroke width", which is what the old Canvas2D renderer took; keeping that signature is what lets
// the whole draw layer move to WebGL without touching how a single glyph or ship is described.
//
// Two things the 2D context used to do for us have to happen here instead: parsing CSS colours,
// and the translate/rotate an entity is drawn under.

import { cos, sin } from "../core/system";
import { dot, seg } from "./lines";

/** Current model transform — the GL equivalent of `ctx.translate(x, y); ctx.rotate(a)`. */
let ox = 0;
let oy = 0;
let cs = 1;
let sn = 0;

/** Draws everything that follows rotated by `a` about `(x, y)`, until `resetXform`. Does not nest. */
export const xform = (x: number, y: number, a: number): void => {
  ox = x;
  oy = y;
  cs = cos(a);
  sn = sin(a);
};

export const resetXform = (): void => {
  ox = oy = sn = 0;
  cs = 1;
};

// Colours are authored as CSS hex strings (tuning.ts `COL`), but the batch wants one packed
// little-endian ABGR word per vertex. Parsing is memoised on the string itself: the palette is a
// handful of constants reused thousands of times a frame.
//
// Written as a bare object with computed access on purpose — Terser mangles *static* property
// names, and a dynamic key is never touched.
const cache: Record<string, number> = {};

/** Packs a `#rgb` or `#rrggbb` CSS colour into the uint32 the beam shader's `aC` attribute expects. */
export const packCss = (css: string): number => {
  let v = cache[css];
  if (v === undefined) {
    let hex = css.slice(1);
    if (hex.length < 6) hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
    const n = parseInt(hex, 16);
    // 0xRRGGBB -> R in byte 0, G in byte 1, B in byte 2, opaque alpha in byte 3.
    v = cache[css] = (((n >> 16) & 255) | (n & 0xff00) | ((n & 255) << 16) | 0xff000000) >>> 0;
  }
  return v;
};

/**
 * Emits every edge of a flat interleaved polyline.
 *
 * `width` is a HALF-width, the unit `lines.ts` `seg` and the beam shader work in — do not halve it
 * again here, or every line comes out at half its intended thickness.
 */
export const line = (points: number[], color: string, width = 1.3, close = false): void => {
  const col = packCss(color);
  const w = width;
  const n = points.length >> 1;
  let px = 0;
  let py = 0;
  for (let i = 0; i < n; i++) {
    const lx = points[i * 2]!;
    const ly = points[i * 2 + 1]!;
    const x = ox + lx * cs - ly * sn;
    const y = oy + lx * sn + ly * cs;
    if (i) seg(px, py, x, y, col, w);
    px = x;
    py = y;
  }
  if (close && n > 1) {
    const lx = points[0]!;
    const ly = points[1]!;
    seg(px, py, ox + lx * cs - ly * sn, oy + lx * sn + ly * cs, col, w);
  }
};

/** A round glowing blob — what a `fillRect` of a couple of pixels used to stand in for. `width`
 *  is a half-width, as in `line`. */
export const point = (x: number, y: number, color: string, width: number): void => dot(x, y, packCss(color), width);
