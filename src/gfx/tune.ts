// Debug-only live tuning for the beam/bloom renderer, the tube's far-centre parallax, the
// attract:logo animation clock and the rainbow-flush flash duration, read by
// `gl.ts`/`lines.ts`/`bloom.ts`/`index.ts`/`game/hud.ts` and written only by `dev/gui.ts`.
//
// Every getter here is `__DEBUG__ ? tune.x : X`. In a release build `__DEBUG__` is the Vite
// literal `false`, so Terser's (safe, not `unsafe_*`) conditional-folding reduces the whole
// expression to the bare `tuning.ts` constant — the same constant the shader source used to bake
// in directly. That leaves `tune` referenced from nowhere reachable in the release graph, so the
// object — and, transitively, `dev/gui.ts` and the `dat.gui` devDependency it imports — never
// ship, exactly like `dev/gui.ts`'s own `if (__DEBUG__)` guard in `index.ts`.
import {
  BEAM_GAIN,
  FLUSH_FLASH_MS,
  GLOW_GAIN,
  GLOW_PASSES,
  GLOW_RADIUS,
  GLOW_SCALE,
  GLOW_SOURCE,
  HALO_INTENSITY,
  HALO_SCALE,
  LOGO_TICK_MS,
  PARALLAX,
  PARALLAX_MS,
  TONEMAP,
  WIDE_GAIN,
} from "../tuning";

// Every key is computed (`["name"]`), not bare — `dev/gui.ts` hands dat.GUI these exact strings
// (`.add(tune, "beamGain")` and so on) to read/write by name, so mangle.properties would otherwise
// rename the property but not dat.GUI's string, breaking the binding silently. Currently moot in
// practice (debug mode never minifies, and release tree-shakes `tune` away entirely once its
// `__DEBUG__` guards fold), but a future build mode that combines the two should not silently
// break this.
/** Mutated only by `dev/gui.ts`, in a debug build. */
export const tune = {
  ["beamGain"]: BEAM_GAIN,
  ["haloIntensity"]: HALO_INTENSITY,
  ["haloScale"]: HALO_SCALE,
  ["glowScale"]: GLOW_SCALE,
  ["passes"]: GLOW_PASSES,
  ["radius"]: GLOW_RADIUS,
  ["sourceGain"]: GLOW_SOURCE,
  ["glowGain"]: GLOW_GAIN,
  ["wideGain"]: WIDE_GAIN,
  ["tonemap"]: TONEMAP,
  ["parallax"]: PARALLAX,
  ["parallaxMs"]: PARALLAX_MS,
  ["logoTick"]: LOGO_TICK_MS,
  ["flushFlashMs"]: FLUSH_FLASH_MS,
};

// Baked into the beam shader source (gl.ts) — changing one needs `lines.ts` `rebuildBeam()`.
export const beamGain = (): number => (__DEBUG__ ? tune.beamGain : BEAM_GAIN);
export const haloIntensity = (): number => (__DEBUG__ ? tune.haloIntensity : HALO_INTENSITY);
export const haloScale = (): number => (__DEBUG__ ? tune.haloScale : HALO_SCALE);

// Read fresh every `bloom.ts` `post()` call — no rebuild needed.
export const glowPasses = (): number => (__DEBUG__ ? tune.passes : GLOW_PASSES);
export const glowRadius = (): number => (__DEBUG__ ? tune.radius : GLOW_RADIUS);
/** Read every frame in `lines.ts` `endFrame()` — no rebuild needed. */
export const sourceGain = (): number => (__DEBUG__ ? tune.sourceGain : GLOW_SOURCE);

// Sizes the glow render targets — changing it needs `bloom.ts` `rebuildBloom()`.
export const glowScale = (): number => (__DEBUG__ ? tune.glowScale : GLOW_SCALE);
// Baked into the composite shader source (bloom.ts) — changing one needs `rebuildComposite()`.
export const glowGain = (): number => (__DEBUG__ ? tune.glowGain : GLOW_GAIN);
export const wideGain = (): number => (__DEBUG__ ? tune.wideGain : WIDE_GAIN);
export const tonemap = (): number => (__DEBUG__ ? tune.tonemap : TONEMAP);

// Read every step by `index.ts` `updateParallax` — nothing to rebuild, the far centre is a
// per-frame offset rather than anything baked into a shader.
export const parallax = (): number => (__DEBUG__ ? tune.parallax : PARALLAX);
export const parallaxMs = (): number => (__DEBUG__ ? tune.parallaxMs : PARALLAX_MS);

// Read once per attract:logo frame (`game/hud.ts` `renderAttractTitle`) / rainbow-flush press
// (`index.ts` `startFlush`, `drawArena`) — no rebuild needed, both are plain ms values.
export const logoTick = (): number => (__DEBUG__ ? tune.logoTick : LOGO_TICK_MS);
export const flushFlashMs = (): number => (__DEBUG__ ? tune.flushFlashMs : FLUSH_FLASH_MS);
