// Release-mode stand-in for `dev/gui.ts`, swapped in by `vite.config.ts`'s `resolve.alias`
// (keyed on build mode) rather than relied on to fall out of `if (__DEBUG__)` dead-code
// elimination on its own. That guard alone does NOT keep `dat.gui` out of a real release build
// (confirmed empirically — the release zip roughly doubled without this file): `dat.gui`'s own
// bundled module has import-time side effects (it injects its stylesheet), so Rollup/Rolldown
// keeps that code reachable regardless of whether the *call* to `initDevGui()` is ever reached —
// an unconditional `import` unconditionally runs the module it imports. Terser can (and does)
// still eliminate `initDevGui`'s own dead call site and body; it just can't reach past the import
// boundary into a side-effecting dependency. Aliasing the specifier itself means `dat.gui` never
// enters the release module graph in the first place, side effects included.
import type { Screen } from "../scenes/modes";

export const initDevGui: (
  goToScreen: (screen: Screen) => void,
  goToAttractPage: (page: number) => void,
  winLevel: () => void,
  loseLife: () => void,
  setLevel: (ordinal: number) => void,
  awardLife: () => void,
) => () => void = () => () => {};
