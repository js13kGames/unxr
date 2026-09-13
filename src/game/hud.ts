// Screen and HUD drawing — every mode-facing draw path pulled out of `index.ts` (arena/enemy/ship
// drawing stays there; this file is screens and the HUD grid). Every timer here reads
// `state.t` / `state.music`; nothing counts frames.
import { isMobile, touchUI } from "../core/viewport";
import { line, resetXform, xform } from "../gfx/beam";
import { copyright, text, textWidth, unxrLogo } from "../gfx/font";
import { logoTick } from "../gfx/tune";
import { CENTER_X, CENTER_Y, hudScale, NEAR, promptY, titleY, vh, vw } from "../layout";
import { Stage } from "../scenes/modes";
import {
  ATTRACT_LOGO_AT,
  BEAT,
  COL,
  COL_BLUE,
  COL_CYAN,
  COL_GREEN,
  COL_MAGENTA,
  COL_PLAYER,
  COL_RED,
  COL_WHITE,
  COL_YELLOW,
  EDGE_PAD,
  ENTRY_BEATS,
  FLUSH_CHARGES,
  SELECT_BLINK_MS,
} from "../tuning";
import { attractTitleFrame, avgScale, depthColor, skillBonus, skillLevel } from "./model";
import { names as rankNames, scores as rankScores } from "./ranking";
import { INI_CHARS, saved, state } from "./state";

const pad = (n: number, width: number): string => {
  let s = `${n | 0}`;
  while (s.length < width) s = `0${s}`;
  return s;
};

// `size` and `y` follow the vector font's own convention: a glyph stands 4x its `size` tall, and
// `y` is the top of that box. The default stroke width is `size / 4`; `width` overrides it wherever
// a call site deliberately draws a heavier stroke.
/** `align`: 0 left, 1 centre, 2 right — forwarded to the vector font as-is. */
const label = (
  value: string,
  x: number,
  y: number,
  size = 6,
  align: 0 | 1 | 2 = 1,
  color = COL_WHITE,
  width = Math.max(0.7, size / 4),
): void => text(value, x, y, size, color, width, align);

/** The cabinet vector font has no `+` glyph, so draw the extra-life marker from two strokes. */
const renderLifeAward = (): void => {
  const size = 7;
  const y = CENTER_Y - 12;
  const plusHalf = 5;
  const gap = 7;
  const words = "1 LIFE";
  const left = CENTER_X - (plusHalf * 2 + gap + textWidth(words, size)) / 2;
  const plusX = left + plusHalf;
  const plusY = y + size * 2;
  line([plusX - plusHalf, plusY, plusX + plusHalf, plusY], COL_WHITE, size / 4);
  line([plusX, plusY - plusHalf, plusX, plusY + plusHalf], COL_WHITE, size / 4);
  label(words, left + plusHalf * 2 + gap, y, size, 0, COL_WHITE);
};

const bandColour = (): string => COL[((state.level - 1) >> 4) % COL.length]!;

/** A closed, symmetric outline heart centred on its bottom point. */
const HEART = [-21, -6, -14, -13, -7, -13, 0, -6, 7, -13, 14, -13, 21, -6, 0, 14, -21, -6];
/** Centre-to-centre spacing keeps all six hearts legible on a portrait phone. */
const HEART_PITCH = 48;

/** Draw a flat pink heart for one remaining life. */
const drawLifeHeart = (x: number, y: number): void => {
  xform(x, y, 0);
  line(HEART, COL_MAGENTA, 1.2);
  resetXform();
};

// The high-score row's own anchors and size, shared with the level number stacked under it.
const HI_X = 560;
const HI_Y = 16;
const HI_SIZE = 3.2;
const hiRow = (): string => `HI ${pad(rankScores[0]!, 6)} ${rankNames[0]}`;

// The HUD grid was authored for a 960-wide cabinet screen, and `hudScale` scales its offsets but not
// the glyph sizes — which holds up on a desktop viewport and breaks down on a phone, where the
// six-digit score outgrows the room its right-aligned anchor leaves and clips off the left edge.
// So the mobile form factor gets its own anchors: each row hugs the screen edge it belongs to,
// which cannot clip at any width. Desktop keeps the authored grid unchanged.

/** Current and best score, shared by Game and Attract so their formatting and placement cannot drift.
 *  Both rows are white: the high score and its initials read as the same kind of number as the score
 *  itself, so only the level and the rainbow row track the band. */
const renderScoreHeader = (): void => {
  if (isMobile) {
    label(pad(state.score, 6), EDGE_PAD, 10, 6, 0);
    label(hiRow(), vw - EDGE_PAD, HI_Y, HI_SIZE, 2);
  } else {
    label(pad(state.score, 6), 300 * hudScale, 10, 6, 2);
    label(hiRow(), HI_X * hudScale, HI_Y, HI_SIZE, 1);
  }
};

/** Left edge of the initials inside the high-score row. They are its last token, so their x is the
 *  row's right edge less their own width — no per-glyph pen walk needed, on either layout. */
const hiNameX = (): number =>
  (isMobile ? vw - EDGE_PAD : HI_X * hudScale + textWidth(hiRow(), HI_SIZE) / 2) - textWidth(rankNames[0]!, HI_SIZE);

/** Right edge of the "HI <score>" portion of the high-score row, less its trailing " <name>" —
 *  where the transition's "LEVEL" label right-aligns to, so it pairs with the high score the same
 *  row already pairs the level numeral with the name, rather than with the player's own (often far
 *  distant, on a wide viewport) current-score display. */
const hiScoreRightX = (): number =>
  (isMobile ? vw - EDGE_PAD : HI_X * hudScale + textWidth(hiRow(), HI_SIZE) / 2) -
  textWidth(` ${rankNames[0]!}`, HI_SIZE);

// --- Game screen HUD (offsets authored for a 960-wide screen; see hudScale) ---

/** Score / lives / level / rainbow-flush row, drawn last and out of the bloom entirely — text
 *  that bloomed would stop being legible at exactly the moments the playfield is brightest. */
export const renderHud = (): void => {
  const band = bandColour();
  renderScoreHeader();

  // Two stacked columns: spare lives in their own row under the score (not beside it) with the
  // rainbow-flush charge pips under them, and the level as a bare numeral under the high score's
  // initials, at the initials' own size.
  // Hearts use the palette's magenta rather than the level band, making the row read as lives; the
  // score stays white, the most-read number on the screen, and the rest tracks the band.
  // On mobile their pitch stops scaling, so the outlines cannot overlap.
  const lifeX = isMobile ? EDGE_PAD + 12 : 40 * hudScale;
  const pitch = isMobile ? HEART_PITCH : 48 * hudScale;
  const pipX = isMobile ? EDGE_PAD + 4 : 32 * hudScale;
  const pipS = isMobile ? 1 : hudScale;
  const pipY = 80;
  for (let i = 0; i < state.lives; i++) drawLifeHeart(lifeX + i * pitch, 54);
  // Two pips, one per charge: 12px long on a 16px pitch.
  for (let i = 0; i < FLUSH_CHARGES; i++) {
    const on = i < state.flush;
    line([pipX + i * 16 * pipS, pipY, pipX + (i * 16 + 12) * pipS, pipY], on ? COL_WHITE : band, on ? 1.2 : 0.7);
  }

  const levelY = HI_Y + HI_SIZE * 4 + 5;
  // The old tunnel is gone and the new one still growing in for the whole of Entry — exactly the
  // window "LEVEL" is meant to span. A separate label, right-aligned onto the high score's own
  // right edge, so the level numeral itself never moves off the name it's always aligned under.
  if (state.stage === Stage.Entry) label("LEVEL", hiScoreRightX(), levelY, HI_SIZE, 2, band);
  label(`${state.level}`, hiNameX(), levelY, HI_SIZE, 0, band);
};

// --- Attract ---

const TITLE_COLORS = [COL_WHITE, COL_YELLOW, COL_MAGENTA, COL_RED, COL_CYAN, COL_GREEN, COL_BLUE];
const FINAL_LOGO_SCALE = avgScale(47);

/** Shared depth renderer for the animated title sequence's nested-box and logo layers. */
const renderAttractTitle = (local: number): void => {
  const frame = attractTitleFrame(local, logoTick());
  const x = vw / 2;
  const y = vh / 2;
  let depth = frame.front;
  let color: string;
  do {
    const scale = avgScale(depth);
    color = TITLE_COLORS[depthColor(depth, frame.front)]!;
    if (frame.box) {
      const halfW = 500 * scale * (vw / 1024);
      const halfH = 540 * scale * (vh / 1024);
      line([x - halfW, y - halfH, x + halfW, y - halfH, x + halfW, y + halfH, x - halfW, y + halfH], color, 0.7, true);
    } else {
      const ratio = scale / FINAL_LOGO_SCALE;
      const logoWidth = vw * 0.7 * ratio;
      const centerY = y - vh * 0.21 * ratio;
      unxrLogo(x, centerY, logoWidth, color, Math.max(0.55, (logoWidth / 745) * 2.5));
    }
  } while ((depth += 2) < frame.back);

  // Once the depth stack settles (front meets back), the zoom is done: invite the player in.
  // Attract:Logo never times out on its own — this prompt, not a clock, is the whole point.
  const promptSize = 6;
  const lineDown = promptSize * 4; // one PRESS START text line, pushed down along with the copyright below it
  if (frame.front === frame.back && state.t % 900 < 600)
    label("PRESS START", x, vh * 0.47 + lineDown, promptSize, 1, COL_RED, 2.2);

  // Tall/mobile viewports cap the 200-unit line at 50% of vw; wide desktops keep the old vh scale.
  const size = Math.min(vw * 0.03, vh * 0.027) / 4;
  // The loop above leaves `color` at its final (innermost) layer's value, so the copyright line
  // picks up that same colour.
  copyright("MMXXVI GLEBV", x, vh * 0.75 + lineDown, size, color, Math.max(0.6, size / 4));
};

export const renderAttract = (): void => {
  const local = state.t - ATTRACT_LOGO_AT;
  if (local < 0) {
    renderScoreHeader();
    const gameOver = state.t % 2000 < 1000;
    label(gameOver ? "GAME OVER" : "PRESS START", vw / 2, vh * 0.15, 4, 1, gameOver ? COL_GREEN : COL_RED);
    label("HIGH SCORES", vw / 2, vh * 0.22, 8, 1, COL_RED, 2);
    const rankX = vw / 2 - 120;
    const nameX = vw / 2 - 90;
    const scoreX = vw / 2 + 10;
    for (let i = 0; i < 8; i++) {
      const y = vh * (0.32 + i * 0.05);
      label(`${i + 1}`, rankX, y, 4.5, 2, COL_BLUE, 1.1);
      label(rankNames[i]!, nameX, y, 4.5, 0, COL_BLUE, 1.1);
      label(`${rankScores[i]}`, scoreX, y, 4.5, 0, COL_BLUE, 1.1);
    }
    label(`RANKING FROM 1 TO ${saved.ngames}`, vw / 2, vh * 0.77, 4, 1, COL_RED);
    // No dot in the font (font-data.ts FONT_CHARS) — the double space stands in for "9. PLAYER 1".
    if (state.rank) label(`${state.rank}  PLAYER 1`, vw / 2, vh * 0.83, 4, 1);
    label("BONUS EVERY 20000", vw / 2, vh * 0.92, 4, 1, COL_CYAN);
  } else {
    renderAttractTitle(local);
  }
};

// --- Start-Level Select ---

// Five consecutive levels are visible. The selector walks across 1..3, stays centred while the
// list scrolls through 4..79, then walks across the final two positions for 80 and 81.
export const renderStartLevelSelect = (): void => {
  // The title sits above its usual band to clear the NOVICE/EXPERT row, which is what tells the
  // player what the row of levels actually rates — "RATE YOURSELF" only reads as an instruction
  // next to them.
  label("RATE YOURSELF", vw / 2, titleY - 40, 6, 1);
  const first = Math.max(0, Math.min(23, state.selectedIndex - 2));
  const n = 5;
  const gap = Math.min(120, (vw - 40) / n);
  const startX = vw / 2 - ((n - 1) * gap) / 2;
  const endX = startX + (n - 1) * gap;
  label("NOVICE", startX, titleY + 40, 3.6, 0, COL_RED);
  label("EXPERT", endX, titleY + 40, 3.6, 2, COL_RED);
  const fit = Math.min(1, (gap * 0.85) / textWidth("99", 8));
  // During the post-confirm flash, the selected entry's digit, its underline and its bonus all
  // blink between COL_PLAYER and COL_WHITE — colour only, nothing resizes. An earlier version also
  // swapped size, which read as a harsh pop between two shapes each cycle. The toggle cadence,
  // SELECT_BLINK_MS, is also the confirm chime's own note spacing (`index.ts`
  // updateStartLevelSelect), so every colour pulse lands on a note.
  const blinkOff = state.selFlash > 0 && ((state.selFlash / SELECT_BLINK_MS) | 0) % 2 === 0;
  for (let i = 0; i < n; i++) {
    const level = skillLevel(first + i);
    const sel = level === state.selected;
    const col = sel && !blinkOff ? COL_PLAYER : COL_WHITE;
    const x = startX + i * gap;
    const size = (sel ? 8 : 6) * fit;
    text(`${level}`, x, titleY + 100, size, col, Math.max(0.6, (sel ? 1.9 : 1.45) * fit), 1);
    if (sel) {
      const w = textWidth(`${level}`, size) / 2 + 6 * fit;
      line([x - w, titleY + 80, x + w, titleY + 80], col, 1.1 * fit);
      text(`${skillBonus(level)}`, x, titleY + 180, 3.4 * fit, col, 0.85 * fit, 1);
    }
  }
  // The two controls read as two instructions, so they get a line and a colour each — the change
  // gesture above the one that commits. Each names the control the player actually has: a finger
  // swipes and taps, a keyboard has no knob.
  // On a phone the two-line block is centred in the complete gap below the tunnel. `42` is the
  // block's rendered height: 28px between line tops plus the font's ~14px cap height.
  const controlsY = isMobile ? (CENTER_Y + NEAR + vh - 42) / 2 : promptY - 28;
  label(touchUI ? "SWIPE TO CHANGE" : "ARROWS TO CHANGE", vw / 2, controlsY, 3.4, 1, COL_CYAN);
  label(touchUI ? "TAP TO SELECT" : "SPACE TO SELECT", vw / 2, controlsY + 28, 3.4, 1, COL_YELLOW);
};

// --- Initials ---

export const iniChar = (index: number): string => INI_CHARS[state.iniChars[index]!]!;

export const renderInitials = (): void => {
  label("ENTER YOUR INITIALS", vw / 2, titleY, 5, 1);
  const size = 10;
  const gap = 60;
  const startX = vw / 2 - gap;
  for (let i = 0; i < 3; i++) {
    const active = i === state.iniIndex;
    const blink = active && state.t % 1000 < 500;
    const col = active ? COL_PLAYER : COL_WHITE;
    if (!blink) label(iniChar(i), startX + i * gap, titleY + 120, size, 1, col, 2);
  }
  const swipe = touchUI ? "SWIPE " : "";
  const confirm = `${swipe}LEFT RIGHT - POSITION   ${touchUI ? "TAP" : "SPACE"} - CONFIRM`;
  const helpSize = Math.min(2.8, (vw - 20) / textWidth(confirm, 1));
  const helpY = isMobile ? (titleY + 160 + vh - 28 - helpSize * 4) / 2 : promptY - 28;
  label(`${swipe}UP DOWN - LETTER`, vw / 2, helpY, helpSize, 1, COL_CYAN);
  label(confirm, vw / 2, helpY + 28, helpSize, 1, COL_YELLOW);
};

// --- Game Over ---

export const renderGameOver = (): void => {
  label("GAME OVER", vw / 2, vh / 2 - 20, 10, 1, COL_WHITE, 2.4);
};

// --- Game-internal stage overlays (Entry countdown, Death, Pause) ---

// Each y carries the half-cap-height offset that used to come from the font's centre anchor.
export const renderStageOverlay = (): void => {
  if (state.stage === Stage.Entry) {
    label(String(Math.max(1, ENTRY_BEATS - Math.floor(state.t / (BEAT * 1000)))), CENTER_X, CENTER_Y - 23, 11.5, 1);
    // The rainbow-flush control, taught every wave in the one stage with a free prompt band — Play
    // itself stays clean, carrying only the charge pips.
    label(touchUI ? "DOUBLE TAP - RAINBOW FLUSH" : "SHIFT - RAINBOW FLUSH", vw / 2, promptY, 3.4, 1, bandColour());
  } else if (state.stage === Stage.Pause) label("PAUSED", CENTER_X, CENTER_Y - 12, 6, 1);
  else if (state.stage === Stage.Flight) {
    label("RAINBOW FLUSH RECHARGE", vw / 2, promptY, 3.4, 1, bandColour());
    // Above the tube rather than across its centre (Death's/Pause's own slot): every spike's far
    // end converges on that centre point, so a label there sat on top of exactly the geometry it
    // was warning about. Anchored to the tube's own top edge (`CENTER_Y - NEAR`) rather than a
    // fixed y so it tracks the reclaimed HUD-to-tube gap on both compact desktop and mobile
    // layouts. `state.burstT` is 0 until the burst phase's quadratic ease has already produced a
    // few percent of visible growth — clearing right at `burstT === 0` (the instant the burst
    // phase opens, before that ease has moved anything yet) left a beat of visibly static tunnel
    // between the warning vanishing and the launch actually reading as started; this still clears
    // well before the launch is in full swing.
    if (state.burstT < 0.2 && state.spikes.some((z) => z < 1))
      label("AVOID SPIKES", CENTER_X, CENTER_Y - NEAR - 32, 3.6, 1);
  }
  if (state.lifeFlash > 0) renderLifeAward();
};

/** "Turn the phone back" prompt while a touch device is held sideways — gameplay is frozen behind it. */
export const renderRotate = (): void => label("ROTATE DEVICE", vw / 2, vh / 2 - 12, 6, 1);
