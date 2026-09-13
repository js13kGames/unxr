// Every screen-size-derived number lives here, recomputed from the real viewport (see
// core/viewport.ts) whenever it actually changes. Kept out of render — `update` calls `relayout()`
// first thing, because `rimPoint` reads these values both to draw and to place hits, so the
// geometry they read must already be this step's.
//
// RHYTHM_H gets its own reserved band rather than sharing the prompt band, which would put
// chevrons through banner text.
import { min } from "./core/system";
import { isMobile, viewH, viewW } from "./core/viewport";
import {
  ARENA_H_FILL,
  ARENA_W_FILL,
  EDGE_PAD,
  GAP,
  HUD_H,
  MOBILE_PROMPT_LIFT,
  PERSP_R,
  PROMPT_H,
  RHYTHM_H,
  TITLE_H,
  VANISH_LIFT,
} from "./tuning";

export let vw: number;
export let vh: number;

/** Near-rim radius, and the far rim's, in logical px. */
export let NEAR: number;
export let FAR: number;
export let CENTER_X: number;
export let CENTER_Y: number;
/** Centre of the far rim — lifted above the near one, which is what tilts the tube towards the player. */
export let VANISH_Y: number;

export let titleY: number;
export let promptY: number;
/** Centre of the rhythm marker's own band, directly above the prompt row. */
export let rhythmY: number;

/** HUD element x-offsets are authored for a 960-wide screen — multiply by this to fit the real width. */
export let hudScale: number;

/** True while a mobile device is held sideways — gameplay freezes and a "rotate device" prompt takes over. */
export let rotateLocked = false;

const TOP_RESERVE = HUD_H + GAP + TITLE_H;
// On desktop the Game screen draws no title, so its arena reclaims that band: it sits higher and
// larger, filling the space between the HUD row and the rhythm marker instead of leaving a wide gap
// above. Every other arena screen (Start-Level Select) keeps the full reserve so its title has
// room, and `titleY` stays put. Mobile keeps the full reserve everywhere — there the arena is
// width-bound, so the extra height would not enlarge it, only shift it off-centre.
const GAME_TOP_RESERVE = HUD_H - GAP;
const BOTTOM_RESERVE = GAP + RHYTHM_H + PROMPT_H + EDGE_PAD;

let wasCompact = false;

export const relayout = (isGame = false): void => {
  const w = viewW();
  const h = viewH();
  const compact = isGame && !isMobile;
  if (w === vw && h === vh && compact === wasCompact) return; // only a real change moves any of this
  vw = w;
  vh = h;
  wasCompact = compact;
  rotateLocked = isMobile && vw > vh;
  hudScale = vw / 960;

  // ARENA_*_FILL are fractions of the *diameter* (the whole near rim, corner to corner) — NEAR is
  // the radius, so halve whichever bound is tighter.
  const top = compact ? GAME_TOP_RESERVE : TOP_RESERVE;
  const availH = vh - top - BOTTOM_RESERVE;
  NEAR = min(vw * ARENA_W_FILL, availH * ARENA_H_FILL) / 2;
  FAR = NEAR / PERSP_R;
  CENTER_X = vw / 2;
  CENTER_Y = top + availH / 2;
  VANISH_Y = CENTER_Y - NEAR * VANISH_LIFT;

  titleY = TOP_RESERVE - TITLE_H;
  // A phone's own gesture bar sits closer to the content than a desktop window's edge does, so
  // mobile gets extra clearance here — everything anchored to promptY (both Start-Level Select
  // control-hint lines, the Game-screen overlay's own prompt line, and — through it — the rhythm
  // marker's mobile-only midpoint below) lifts together.
  promptY = vh - PROMPT_H - EDGE_PAD - (isMobile ? MOBILE_PROMPT_LIFT : 0);
  // The rhythm marker's y. Desktop keeps the reserved-band convention (RHYTHM_H sits GAP below the
  // arena band, so its centre is `GAP + RHYTHM_H / 2` above the prompt). Mobile instead centres the
  // marker in the whitespace it actually has: the near rim is the lowest the tube is drawn
  // (`CENTER_Y + NEAR`), so halfway between that and the prompt row leaves an equal gap above the
  // marker (to the tube) and below it (to the prompt line).
  rhythmY = isMobile ? (CENTER_Y + NEAR + promptY) / 2 : promptY - GAP - RHYTHM_H / 2;
};
