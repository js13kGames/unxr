// Destructuring Math once lets Terser mangle every call site to a single-character
// local instead of repeating the `Math.` prefix throughout the bundle.
export const { abs, atan2, cos, floor, max, min, random, round, sin, sqrt } = Math;
