import { LOGO_TICK_MS } from "../tuning.ts";

export interface Point {
  x: number;
  y: number;
}

/** Shape indices whose arena is open (two physical edges, no wraparound) rather than closed —
 *  Saw Ramp, Flat, Double Wave, and Spiral Sector. A bitmask keeps this a single foldable
 *  constant instead of a lookup table. */
const OPEN_MASK = (1 << 8) | (1 << 9) | (1 << 10) | (1 << 13) | (1 << 14);
export const openArena = (shape: number): boolean => ((OPEN_MASK >> shape) & 1) !== 0;
export const laneCount = (shape: number): number => (openArena(shape) ? 15 : 16);

const TAU = Math.PI * 2;

/** A point on a regular `n`-gon of circumradius 1 at angle `t`, its flat sides centred `phase`
 *  radians apart from the angle origin. Shared by the two POLYGON shapes (square, triangle) —
 *  every other shape below is distinct enough (different trig terms, different exponents) that a
 *  shared helper would cost more than it saves. */
const nGon = (n: number, t: number, phase: number): Point => {
  const seg = TAU / n;
  const m = ((((t - phase) % seg) + seg) % seg) - seg / 2;
  const r = Math.cos(Math.PI / n) / Math.cos(m);
  return { x: r * Math.cos(t), y: r * Math.sin(t) };
};

/** One point of shape's rim curve at fraction `u` of the way round (closed) or along (open) the
 *  form, before arc-length resampling. Closed forms rotate their angle by `-PI/2` so lane 0 sits
 *  at the top. */
const shapeCurve = (shape: number, u: number): Point => {
  const t = -Math.PI / 2 + TAU * u;
  switch (shape) {
    case 0: // Circle
      return { x: Math.cos(t), y: Math.sin(t) };
    case 1: // Square
      return nGon(4, t, Math.PI / 4);
    case 2: {
      // 4-lobe Rotor
      const r = 1 + 0.22 * Math.cos(4 * t);
      return { x: r * Math.cos(t), y: r * Math.sin(t) };
    }
    case 3: // Peanut / Hourglass
      return { x: Math.cos(t), y: Math.sin(t) * (0.32 + 0.68 * Math.abs(Math.cos(t))) };
    case 4: {
      // Cog
      const r = 1 + 0.2 * Math.cos(8 * t);
      return { x: r * Math.cos(t), y: r * Math.sin(t) };
    }
    case 5: // Triangle
      return nGon(3, t, 0);
    case 6: {
      // Trefoil
      const r = 1 + 0.27 * Math.cos(3 * t);
      return { x: r * Math.cos(t), y: r * Math.sin(t) };
    }
    case 7: {
      // Heart — the classic closed-form heart curve, tip down. Uses its own angle (not `t`): the
      // formula already fixes the orientation, so the shared `-PI/2` top-of-circle rotation would
      // just tilt it off-centre.
      const a = TAU * u;
      const s = Math.sin(a);
      return {
        x: 16 * s * s * s,
        y: -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)),
      };
    }
    case 8: {
      // Level 9: Lightning Ridge. The doubled vertical amplitude makes its angular turns read
      // clearly through the perspective web.
      const x = 2 * u - 1;
      const phase = 2 * u + 0.125 - Math.floor(2 * u + 0.125);
      const tri = 1 - 4 * Math.abs(phase - 0.5);
      // Blend the triangle with its eased counterpart: retains a zigzag but makes its tips obtuse.
      const bluntZigzag = 0.4 * tri + 0.6 * Math.sin((Math.PI / 2) * tri);
      return { x, y: 0.18 * x + 0.68 * bluntZigzag };
    }
    case 9: {
      // Level 10: Horseshoe.
      const a = Math.PI * (u - 0.5);
      return { x: Math.sin(a), y: -0.78 * Math.cos(a) };
    }
    case 10: {
      // Flat — kept, tilted down off centre.
      return { x: 2 * u - 1, y: 0.4 };
    }
    case 11: {
      // Level 12: Dimpled Limacon / Kidney.
      const a = TAU * u;
      const r = 1 + 0.62 * Math.cos(a);
      return { x: r * Math.cos(a), y: 0.88 * r * Math.sin(a) };
    }
    case 12: {
      // 6-ray Reactor
      const r = 1 + 0.27 * Math.cos(6 * t);
      return { x: r * Math.cos(t), y: r * Math.sin(t) };
    }
    case 13: {
      // Level 14: Double Wave — the prior readable two-hump profile.
      const x = 2 * u - 1;
      return { x, y: 0.45 * Math.cos(TAU * x) };
    }
    case 14: {
      // Level 15: Double Dome reflected on OX without changing rail order.
      const x = 2 * u - 1;
      const x2 = x * x;
      // Broad profile: the two lobes remain easy to read during rapid play.
      return { x, y: 0.9 * (1 - x2) * (0.08 + 1.35 * x2) };
    }
    default: {
      // Level 16: Crossed Loop — the prior readable asymmetric figure-eight.
      return { x: Math.cos(t), y: 0.6 * Math.sin(2 * t) + 0.15 * Math.sin(t) };
    }
  }
};

// Rim cache: one shape at a time. `rimPoint` (index.ts) always reads the current `shape()`, so
// within a frame the form is fixed; the rebuild only runs on a level change or a Start-Level
// Select scroll. Resampling every call — `drawArena` alone makes 32 — would be far too slow.
// 64 dense samples is enough: past it the resampled rim stops moving (the curves are gentle).
const SAMPLES = 64;
let cachedShape = -1;
const rimX = new Float32Array(16);
const rimY = new Float32Array(16);
const mobileDevice = (): boolean => typeof navigator !== "undefined" && /Mobi|Android|iP/.test(navigator.userAgent);

/** Fills `rimX`/`rimY` with `shape`'s sixteen rim vertices. Densely samples `shapeCurve` over the
 *  fraction `u ∈ [0, 1]` and places the vertices at equal arc-length fractions of the perimeter,
 *  so every lane spans the same length of rim regardless of the shape's curvature. All shapes
 *  share one normalising divisor across both axes, so every arena fills the rim to the same size. */
const buildRim = (shape: number): void => {
  const isMobile = mobileDevice();
  // Level 15 is the one simple open graph that deliberately uses its prescribed direct
  // samples: u = i / 15. All other forms retain arc-length resampling.
  if (shape === 14) {
    let m = 1e-6;
    for (let k = 0; k < 16; k++) {
      const p = shapeCurve(shape, k / 15);
      rimX[k] = p.x;
      rimY[k] = p.y;
      m = Math.max(m, Math.hypot(p.x, p.y));
    }
    // The shallow open profile otherwise reads much smaller than the circular first arena.
    // This is a display-only enlargement; lane indices and movement remain unchanged.
    const level15Scale = isMobile ? 1 : 1.45;
    for (let k = 0; k < 16; k++) {
      rimX[k] = (rimX[k]! / m) * level15Scale;
      rimY[k] = (rimY[k]! / m) * level15Scale;
    }
    return;
  }

  const open = openArena(shape);
  const n = open ? SAMPLES : SAMPLES + 1; // closed: one extra sample closes the loop onto the first
  const px: number[] = [];
  const py: number[] = [];
  const cum: number[] = [0];
  for (let i = 0; i < n; i++) {
    const p = shapeCurve(shape, i / SAMPLES);
    px.push(p.x);
    py.push(p.y);
    if (i) cum.push(cum[i - 1]! + Math.hypot(px[i]! - px[i - 1]!, py[i]! - py[i - 1]!));
  }
  const total = cum[n - 1]!;
  let s = 0;
  for (let k = 0; k < 16; k++) {
    const target = (k / (open ? 15 : 16)) * total;
    while (s < n - 2 && cum[s + 1]! < target) s++;
    const segLen = cum[s + 1]! - cum[s]!;
    const f = segLen > 1e-6 ? (target - cum[s]!) / segLen : 0;
    rimX[k] = px[s]! + (px[s + 1]! - px[s]!) * f;
    rimY[k] = py[s]! + (py[s + 1]! - py[s]!) * f;
  }
  let m = 1e-6;
  for (let k = 0; k < 16; k++) m = Math.max(m, Math.abs(rimX[k]!), Math.abs(rimY[k]!));
  // Lightning Ridge (shape 8) and Flat (shape 10) are stretched on desktop only. Mobile uses
  // each form's original bounds.
  const scaleX = shape === 10 && !isMobile ? 2.8 : shape === 8 && !isMobile ? 1.45 : 1;
  // The desktop enlargements for levels 12, 14, and 16 are deliberately omitted on mobile.
  const scale = isMobile ? 1 : shape === 11 ? 1.6 : shape === 13 ? 1.15 : shape === 15 ? 1.35 : 1;
  for (let k = 0; k < 16; k++) {
    rimX[k] = (rimX[k]! / m) * scaleX * scale;
    rimY[k] = (rimY[k]! / m) * scale;
  }
};

/** Sixteen new runtime-generated forms. No stored source vertices or remap table. Every lane on a
 *  form is the same fraction of the rim's perimeter — see `buildRim`. */
export const arenaPoint = (shape: number, index: number): Point => {
  if (shape !== cachedShape) {
    buildRim(shape);
    cachedShape = shape;
  }
  const i = ((index % 16) + 16) % 16;
  return { x: rimX[i]!, y: rimY[i]! };
};

/** Fold a lane index (possibly fractional, possibly far out of range) back onto the arena the way
 *  the ship's own position is kept: a positive modulo on a closed arena, a clamp on an open one.
 *  A rim-hugging enemy that chases the player across the seam accumulates lane offset every step —
 *  without this its `l` runs past the lane count and `Math.round(e.l)` can never match a real lane
 *  again. The two lane counts are written out rather than read from `laneCount`: this is the one
 *  place both branches are needed at once, and every other 16 in this file is spelled the same way. */
export const wrapLane = (lane: number, shape: number): number =>
  openArena(shape) ? Math.max(0, Math.min(14, lane)) : ((lane % 16) + 16) % 16;

/** A lane step is just a wrap of the destination — the clamp at an open arena's edges and the fold
 *  across a closed one's seam are exactly what `wrapLane` already does. */
export const moveLane = (lane: number, direction: number, shape: number): number => wrapLane(lane + direction, shape);

/** Signed lane delta from `from` to `to` the way the ship actually travels: on a closed arena the
 *  short way round, folded into (-8, 8], so a step from 15 to 0 is +1 rather than -15. An open
 *  arena has no seam, so the plain difference is already right. */
export const laneDelta = (from: number, to: number, shape: number): number => {
  if (openArena(shape)) return to - from;
  const d = wrapLane(to - from, shape);
  return d > 8 ? d - 16 : d;
};

export const seeded =
  (seed: number): (() => number) =>
  () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let n = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };

export const unlockedKinds = (level: number): number =>
  level < 3 ? 1 : level < 4 ? 2 : level < 11 ? 3 : level < 17 ? 4 : 5;

export interface AttractTitleFrame {
  box: boolean;
  front: number;
  back: number;
}

/** Closed forms of the 20 Hz counters: box front waits two ticks, back caps at tick seven;
 * logo front stops at 47, while back starts moving at total tick 53 and catches up at 170.
 * `tickMs` defaults to LOGO_TICK_MS; a debug-only dat.GUI override scales the whole sequence's
 * total runtime by passing a different value in (`game/hud.ts` `renderAttractTitle`). */
export const attractTitleFrame = (localMs: number, tickMs = LOGO_TICK_MS): AttractTitleFrame => {
  const ticks = Math.floor(Math.max(0, localMs) / tickMs);
  const box = ticks < 20;
  return {
    box,
    front: box ? 24 + Math.max(0, ticks - 2) * 8 : Math.max(47, 180 - ticks),
    back: box ? Math.min(165, 25 + ticks * 20) : Math.max(47, Math.min(165, 217 - ticks)),
  };
};

/** A split linear/binary depth-to-scale curve, indexed by the title animation's depth counter. */
export const avgScale = (depth: number): number => (255 - ((depth << 2) & 0x7f)) / (1 << ((depth >> 5) + 7));

/** Logical colour index. Index 7 aliases red, while the foremost layer is always white. */
export const depthColor = (depth: number, front: number): number => {
  if (depth === front) return 0;
  const color = (depth >> 3) & 7;
  return color === 7 ? 3 : color;
};

/** The depth renderer has do-first semantics, so an empty or inverted interval still has a front layer. */
export const depthLayerCount = (front: number, back: number): number => Math.max(1, Math.ceil((back - front) / 2));

/** Highest level offered by Start-Level Select; later levels are reached through play. */
export const START_LEVEL_MAX = 81;
export const START_LEVEL_COUNT = 28;

/** Skill-Step checkpoint by cursor index, generated without shipping the irregular sequence as a
 * lookup table. This yields exactly 1,3,..17; 20,22,..28; 31,33; 36,40,44,47,49,52,56,60,63,65;
 * 73,81. */
export const skillLevel = (index: number): number =>
  index < 9
    ? 1 + index * 2
    : index < 14
      ? 2 + index * 2
      : index < 16
        ? 3 + index * 2
        : index < 26
          ? 33 + Math.round((16 * (index - 15)) / 5) + ((index - 15) % 5 > 1 ? 1 : 0)
          : 73 + 8 * (index - 26);

/** Smooth table-free score progression, rounded to the same 1,000-point granularity as the
 * reference values. It preserves the important anchors: level 1 = 0 and level 9 = 54,000. */
export const skillBonus = (level: number): number => Math.round(((level - 1) * (level + 99)) / 16) * 1000;
