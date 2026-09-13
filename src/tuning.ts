export const STEP = 1000 / 60;
export const BEAT = 0.5;
export const HIT = 0.11;
export const MOVE_MS = 140;
export const MISS_HOLD = 300;
/** Cooldown between auto-shots. Raised from 170 so the gun stays responsive with a live shot cap —
 *  the cap then only bites when spraying into an empty lane, and MISS_HOLD stays the legible pause. */
export const FIRE_MS = 120;
/** Player shots allowed in the air at once — kept low so the miss penalty, not this cap, is the
 *  pause the player reads. */
export const MAX_SHOTS = 5;
/** Player shot speed, in z-units per second. */
export const SHOT_SPEED = 1.55;
export const ENTRY_BEATS = 3;
export const START_LIVES = 3;
export const SCORE = [100, 140, 180, 240, 210] as const;
/** Score threshold for an extra shooter, and the cap on stored lives — the values the HUD's
 *  `BONUS EVERY 20000` label already states. */
export const EXTRA_LIFE = 20000;
export const MAX_LIVES = 6;
/** How long the centred `+1 LIFE` award announcement remains visible. */
export const LIFE_FLASH_MS = 1200;

// --- Rainbow flush (`index.ts` startFlush/updateFlush) ---
// One authored rule produces every value here — a kill every eighth of a beat, the first charge
// until the arena is clear, the second a single enemy — so the flash rate, the kill rate and both
// window lengths are one constant rather than four.
/** Charges per wave. Refilled on wave setup only — a lost life does not buy one back. */
export const FLUSH_CHARGES = 2;
/** Seconds between kills: an eighth of a beat. */
export const FLUSH_TICK = BEAT / 8;
/** Ms within which a second tap is a rainbow flush rather than a steer. Deliberately under half a
 *  beat (250 ms at BEAT): two taps a player means to land as separate on-beat inputs can never be
 *  misread as a double tap. */
export const DOUBLE_MS = 220;
/** Ms the rainbow announcement runs, and ms per colour step within it — a flat real-time timer,
 *  deliberately NOT tied to FLUSH_TICK or the beat. An early version cycled colour with the kill
 *  tick and read as a fast, illegible flicker, especially on the single-kill second charge, which
 *  was over before the eye caught more than one colour: a decorative announcement reads better
 *  decoupled from whatever triggered it. */
export const FLUSH_FLASH_MS = 900;
export const FLUSH_FLASH_STEP = 70;

// --- Enemy fire (index.ts onBeat / updateEnemies) ---
// Everything here runs on one musical clock: the countdown ticks once per `onBeat`, counted in
// beats rather than a separate frame clock. Each enemy owns its own cooldown, a global cap limits
// shots in the air, and a shot blocked by the cap fires the instant a slot frees.
/** Enemy shots allowed in the air at once, by wave ordinal: 1 through level 11, 2 through 23, then 3. */
export const eshotCap = (ordinal: number): number => 1 + Math.min(2, (ordinal / 12) | 0);
/** Beats an enemy waits between shots: ~7-10 on level 1, easing to 2-5 from level 20. `r` is one
 *  `rand()` draw so the cooldown is spread out rather than synchronised across the wave. */
export const eshotHoldoff = (ordinal: number, r: number): number => 2 + r * 3 + Math.max(0, 5 - ordinal / 4);
// --- Colours ---
// Undersaturated on purpose — a 1/16 floor on the "off" channels is what makes heavy overdraw
// bloom to white instead of clipping to a flat colour. Written as CSS strings the way the renderer
// takes them (see gfx/beam.ts `packCss`).
export const COL_BLUE = "#0f0fff";
export const COL_RED = "#ff0f0f";
export const COL_YELLOW = "#ffff0f";
export const COL_CYAN = "#0fffff";
export const COL_GREEN = "#07ff07";
export const COL_MAGENTA = "#ff1ff2";
export const COL_WHITE = "#ffffff";
/** The shooter's own yellow, warmer than COL_YELLOW so it reads against a yellow band. */
export const COL_PLAYER = "#ffd826";
/** The star field's own dim, undersaturated blue-white — deliberately dimmer than the palette
 *  above so a dense field cannot out-shine the tunnel or bloom to a flat white. */
export const COL_STAR = "#4455aa";

/** A shared capacity signal, scaled to the five-shot pool — every player shot reads it for colour. */
export const playerShotColour = (active: number): string =>
  active * 4 < MAX_SHOTS * 3 ? COL_YELLOW : active < MAX_SHOTS ? COL_BLUE : COL_RED;

/** Band / enemy-kind palette: blue, red, yellow, cyan, white, green. */
export const COL = [COL_BLUE, COL_RED, COL_YELLOW, COL_CYAN, COL_WHITE, COL_GREEN] as const;

// --- Screen timings, in ms (`scenes/modes.ts` Screen/Stage) ---

/** High Score holds this long, then Logo takes over and holds indefinitely — nothing times out
 *  of Logo; only a confirm input leaves it. */
export const ATTRACT_LOGO_AT = 20000;
/** Ms per attract:logo animation tick (`game/model.ts` attractTitleFrame's own 20 Hz clock). The
 *  zoom sequence runs a fixed tick count, so scaling this scales its total runtime with it.
 *  Debug-only override lives in gfx/tune.ts. */
export const LOGO_TICK_MS = 50;
/** GameOver holds the run summary this long before advancing on its own. */
export const GAMEOVER_MS = 3000;
/** Horizontal travel that separates a Start-Level Select swipe from a tap, in logical px. */
export const SWIPE_MIN = 24;
/** Ms the Start-Level Select confirm flash runs before the chosen level actually starts
 *  (`index.ts` updateStartLevelSelect) — full-bright/dim on a flat real-time clock, colour only:
 *  `game/hud.ts` renderStartLevelSelect never resizes anything while blinking, since a version
 *  that did read as a harsh pop between two shapes each cycle. */
export const SELECT_FLASH_MS = 480;
/** Ms per colour toggle within the confirm flash, and — the same number — ms between notes of its
 *  confirm chime (`index.ts` updateStartLevelSelect), so every colour pulse lands on a note. */
export const SELECT_BLINK_MS = 90;

// --- Level transition (index.ts rimPoint/updateTubeScale, Stage.Flight) ---
// These numbers are arrived at from the game's own hyperbolic depth projection
// (`z / (0.42 + 0.58z)` in `rimPoint`).
/** How far the tunnel's near rim is stretched past its resting size by `FLIGHT_BURST_AT` — the "old
 *  tunnel rushes past the camera" read. Applied as a lerp toward the tunnel's own far-plane pivot,
 *  so 1 is resting size and above 1 expands outward from that pivot. */
export const TUBE_SCALE_MAX = 2.4;
/** Where `tubeScale` actually ends up by `flight === 1`, after a second, much steeper growth phase
 *  past `FLIGHT_BURST_AT` (`updateTubeScale`). The far rim sits only `FAR` (`NEAR/PERSP_R`, a small
 *  fraction of `NEAR`) from the scale pivot, so `TUBE_SCALE_MAX` alone leaves it — and everything
 *  else that close to the vanishing point — sitting on screen for the whole dive; only a much larger
 *  factor in this last stretch actually carries it past the screen edge, which is what makes the old
 *  tunnel read as flying fully past the player instead of just cutting off. */
export const TUBE_SCALE_BURST = 14;
/** `flight`'s starting rate of advance (in 1/s) and its acceleration (in 1/s²), integrated each
 *  step rather than a flat rate. A flat rate reads as *slowing down* against the hyperbolic depth
 *  projection above; accelerating compensates for that and reads as being launched down the tube.
 *  Chosen so the descent covers `flight` 0→1 in
 *  ~0.9 s, within the transition's own targeted 0.8-1.5 s window. */
export const FLIGHT_INITIAL_SPEED = 0.3;
export const FLIGHT_ACCEL = 1.8;
/** Fraction of `flight` where `tubeScale` leaves its first, gentler climb toward `TUBE_SCALE_MAX` and
 *  starts the second, much steeper one toward `TUBE_SCALE_BURST` (`updateTubeScale`). Kept late so
 *  the old tunnel reads as a normal, moderate stretch for the bulk of the dive, and the burst itself
 *  as one quick beat at the very end. */
export const FLIGHT_BURST_AT = 0.82;
/** Real duration (ms, not a fraction of `flight`) of the burst past `FLIGHT_BURST_AT` — both
 *  `tubeScale`'s second growth phase and the hold before `enterEntry` fires are paced by a wall-clock
 *  timer started the moment `flight` crosses the threshold, not by `flight` itself. `flight` is still
 *  accelerating there, so tying the burst to *it* left the whole climb to `TUBE_SCALE_BURST` to
 *  finish inside the ~6 fixed steps (~100 ms) `flight` takes to cover that last sliver — nowhere near
 *  enough frames to read as motion instead of a jump cut. */
export const FLIGHT_BURST_MS = 350;

// --- Star field (index.ts initStars/updateStars/renderStars) ---
// Procedural: each point's local offset is a deterministic function of its own index (see
// `starOffset`) rather than a stored table, and its depth advances continuously with elapsed time
// rather than in discrete per-frame steps, so it stays correct at any refresh rate.
export const STAR_COUNT = 56;
/** Depth domain a point travels: FAR is where it (re)spawns, NEAR is where it is removed
 *  (active: recycled to FAR; draining: cleared for good). Arbitrary units — only their ratio to
 *  STAR_CAM/STAR_FOCAL below matters for the perspective read. */
export const STAR_FAR = 6;
export const STAR_NEAR = 0.5;
/** Depth units per second a point falls toward the viewer. */
export const STAR_RATE = 4;
/** Perspective-divide shape constants, dimensionless: a point's screen offset is
 *  `NEAR * STAR_FOCAL / (depth + STAR_CAM)` times its own local offset, so it reads as tiny and
 *  near the pivot at STAR_FAR and fans out to roughly the tunnel's own near-rim scale as it
 *  approaches STAR_NEAR. The leading `NEAR` is what brings this into pixel space — without it the
 *  whole field collapses to a sub-pixel cluster on any viewport. */
export const STAR_FOCAL = 1;
export const STAR_CAM = 0.5;
/** Max radius, in the same unit-circle scale `rimPoint`'s `ux`/`uy` use, of a point's local
 *  offset from the pivot — kept well under 1 so the field reads as sitting behind the tunnel
 *  rather than spilling past its rim before the perspective divide even applies. */
export const STAR_SPREAD = 0.85;
/** Fraction of Flight's 0..1 progress at which the field turns on. Each point then runs a single
 *  pass from its own starting depth to STAR_NEAR and stops — no recycling — so by construction
 *  every point is guaranteed to finish (worst case (STAR_FAR - STAR_NEAR) / STAR_RATE of travel)
 *  well inside the remaining Flight time plus all of Entry, and the field can never still be
 *  running once the incoming tunnel reaches its resting scale. */
export const STAR_START_FRAC = 0.4;

// --- Far-end swarm (index.ts updateSwarm/renderSwarm) ---
// Points mill near the vanishing point, then settle onto the far rim before becoming a real enemy
// — read continuously from elapsed time, in `updateSwarm`'s eased spin, never from a frame count.
/** Points on screen at once. A hard cap, not a fraction of `state.pending`: these converge to a few
 *  px around the vanishing point, and the glow renderer blows dense overlap out to white. */
export const SWARM_MAX = 10;
/** A newborn point's starting emergence (of 0..1) — a floor, not 0, so it doesn't sit exactly on the
 *  pivot pixel with every other point about to be born there too. */
export const SWARM_Q0 = 0.2;
/** Emergence gained per second at speed 1 (`updateSwarm`'s per-slot `rate`) — a full pivot-to-rim
 *  pass takes roughly 4-9s depending on slot, slow enough that several points are visibly milling
 *  at once rather than the field reading as a single wave. */
export const SWARM_RATE = 0.18;
/** Lanes per second a point drifts at the pivot, eased to a full stop by `(1 - emergence)` as it
 *  reaches the rim. */
export const SWARM_SPIN = 5;

// --- Death shatter (index.ts shatter/updateFrags/renderFrags) ---

/** Ms a shard survives — short and snappy, so a rainbow-flush cascade of kills doesn't leave the
 *  screen buried in debris. */
export const SHARD_MS = 350;
/** Outward speed, px/s per px of a shard's own offset from its figure's centre — an affine
 *  expansion about that centre, so a shard sitting on it simply spins in place with no divide. */
export const SHARD_SPEED = 18;
/** Base spin, rad/s; varied per shard by index alone (`updateSwarm`'s own idiom), never `rand` —
 *  drawing from it here would shift the wave's deterministic spawn sequence. */
export const SHARD_SPIN = 9;

// --- Layout (layout.ts, core/viewport.ts) ---

/**
 * Logical short-side length. The canvas fills the viewport at its real aspect ratio (see
 * core/viewport.ts) — `BASE` is the size of whichever of width/height is smaller, so every
 * authored size — text, HUD offsets, glyph radii — keeps its intended apparent scale on any
 * device instead of shrinking with the pixel count.
 */
export const BASE = 540;

/** Near-rim diameter as a fraction of the width / of the height left between the reserved bands. */
export const ARENA_W_FILL = 0.88;
export const ARENA_H_FILL = 0.95;
/** Near/far radius ratio — the tube's whole perspective depends on this, not on an absolute FAR. */
export const PERSP_R = 7;
/** How far above the near rim's centre the vanishing point sits, as a fraction of the near radius. */
export const VANISH_LIFT = 46 / 210;
/** Beam half-width of every arena line — rims and spokes alike. The well draws at one width and
 *  one intensity throughout; varying either reads as depth cueing it should not have. */
export const WEB_W = 1.1;

// Far-centre parallax (`index.ts` `updateParallax`). The vanishing point is pushed away from the
// player's own offset from the tube's centre, so orbiting the tube swings the far end and the
// perspective reads as changing rather than fixed. Render-only — see `rimPoint`.
/** How far the far centre leans, as a fraction of the player's own offset from the near centre.
 *  Positive pushes the far end to the side opposite the player — what looking down a real pipe off
 *  its axis does. Negative leans it toward the player instead. */
export const PARALLAX = 0.14;
/** Ease time constant in ms: how long the far centre takes to catch up with the player's lane.
 *  Large enough that a single beat-step glides rather than snaps. */
export const PARALLAX_MS = 260;

// Fixed top/bottom bands, reserved unconditionally (whether or not the current screen/stage draws
// anything there) so the arena never has to move or resize between them, and never has to fight
// the HUD, the rhythm marker, or the prompt for room through a clamp that can lose.
/** Top band: the score / lives / level HUD row. */
export const HUD_H = 108;
/** Reserved height for the title glyph row, in logical px (glyphs are ~4x their `size` tall). */
export const TITLE_H = 58;
/** Bottom band: the rhythm marker and its chevrons. */
export const RHYTHM_H = 78;
/** The beat marker's radius as a fraction of the bar's half-span — the ratio the bar was authored at
 *  (a 13px diamond on a 203px runway), reapplied at every width so the figure never changes shape. */
export const RHYTHM_MARKER = 13 / 203;
/** Reserved height for the press/tap-start prompt row, in logical px. */
export const PROMPT_H = 26;
/** Keep-out from the bottom screen edge for the prompt text, in logical px. */
export const EDGE_PAD = 12;
/** Breathing room between a reserved band and the arena. */
export const GAP = 16;
/** Extra clearance the bottom prompt row gets on mobile, roughly one prompt line's worth — a
 *  phone's own gesture bar sits closer to the content than a desktop window's edge does. Applied
 *  once, to `promptY` (`layout.ts`), so it lifts everything anchored there together: Start-Level
 *  Select's two control-hint lines and the Game-screen overlay's single prompt line alike. */
export const MOBILE_PROMPT_LIFT = 28;

// --- Renderer (core/viewport.ts, gfx/*) ---

/** Backing-store pixel budget (device px, post-DPR). Keeps a high-DPR phone from rendering 3+ Mpx of glow overdraw. */
export const MAX_PIXELS = 1_300_000;

/**
 * Multiplier on a line's crisp core — the picture's master brightness control. Overdriving past 1
 * lets the core clip to full saturation, which is what a real beam does; a thin line otherwise
 * loses most of its peak to the supersample-and-downscale.
 */
export const BEAM_GAIN = 1.8;
/** Multiplier on the analytic shoulder just outside the core, so the picture reads as neon even with bloom down. */
export const HALO_INTENSITY = 0.22;
/** How far that shoulder extends past the core, as a multiple of the mark's own half-width (never absolute px). */
export const HALO_SCALE = 1.2;

/** Glow-band gains: how much of the blur the arena and the HUD feed, relative to gameplay objects. */
export const GRID_GLOW = 0.3;
export const HUD_GLOW = 0;
/** The ship's own gain: full bloom smears the unicorn figure's fine detail (legs, mane, horn) into
 *  a blob, so it feeds the blur at less than gameplay objects while keeping its full-strength core. */
export const SHIP_GLOW = 0.55;

/** Peak squash/stretch on the beat-bounce, as a fraction of a figure's own size. */
export const BOUNCE_AMOUNT = 0.15;
/** Peak extra glow gain riding along with the beat-bounce. */
export const BOUNCE_GLOW = 0.35;

/** Glow-source resolution as a fraction of the backing store. */
export const GLOW_SCALE = 0.5;
/** Separable H+V iterations on the primary halo. Radius comes from this and from GLOW_SCALE. */
export const GLOW_PASSES = 3;
/** Blur step in texels. Past ~1.5 the five-tap kernel separates into discrete ghosts. */
export const GLOW_RADIUS = 1.2;
/** How bright the batch is drawn into the glow source, relative to the core pass. */
export const GLOW_SOURCE = 0.8;
/** Multiplier on the blurred primary halo at composite time. */
export const GLOW_GAIN = 1.1;
/** Multiplier on the second, wider halo. 0 skips that chain entirely. */
export const WIDE_GAIN = 0.4;
/** Exposure roll-off, 0 = hard clip, 1 = full `1 - exp(-c)`. Keeps heavy overlap from going flat white. */
export const TONEMAP = 0.6;
