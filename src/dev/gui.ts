// Dev-only tooling: a `dat.GUI` panel for the beam/bloom renderer (gfx/tune.ts) plus a plain
// top-left text overlay for live readouts.
//
// Both start hidden behind an "Open Controls" tab. Opening it (the tab, the backtick key, or
// dat.GUI's own close-bar to hide again) shows or hides the controls and the readout overlay
// together.
//
// Imported ONLY from `if (__DEBUG__)` in `src/index.ts`. In a release build that is `if (false)`,
// so Rolldown drops this module and the `dat.gui` dependency it imports — dat.gui is a
// devDependency and never ships.
import { GUI } from "dat.gui";
import { round } from "../core/system";
import { state } from "../game/state";
import { bloomIsFloat, rebuildBloom, rebuildComposite } from "../gfx/bloom";
import { rebuildBeam, segCount } from "../gfx/lines";
import { tune } from "../gfx/tune";
import { Screen } from "../scenes/modes";
import { ATTRACT_LOGO_AT } from "../tuning";

const FPS_SAMPLES = 30;
// Screen and stage names in the same vocabulary as `.env`'s START target / `UNXR_START_SCREEN`
// (see `scenes/modes.ts`). Indices line up with the `Screen` and `Stage` enums.
const SCREEN_SLUGS = ["attract", "start-level-select", "game", "game-over", "initials"];
const STAGE_SLUGS = ["game:entry", "game:play", "game:death", "game:flight", "game:pause"];
// Matches `game/hud.ts` `renderAttract`'s page order: high score, then animated logo.
const ATTRACT_SLUGS = ["attract:high-score", "attract:logo"];

/** The current screen — with its Attract page or Game stage folded in — as a `.env`-style name. */
const targetName = (): string => {
  if (state.screen === Screen.Attract) return ATTRACT_SLUGS[+(state.t >= ATTRACT_LOGO_AT)]!;
  if (state.screen === Screen.Game) return STAGE_SLUGS[state.stage]!;
  return SCREEN_SLUGS[state.screen] ?? "?";
};

/** Builds the panel and returns a per-render tick that refreshes the live readouts. */
export const initDevGui = (
  goToScreen: (screen: Screen) => void,
  goToAttractPage: (page: number) => void,
  winLevel: () => void,
  loseLife: () => void,
  setLevel: (ordinal: number) => void,
  awardLife: () => void,
): (() => void) => {
  const gui = new GUI({ width: 320 });
  let panelOpen = false;
  gui.domElement.style.display = "none";

  // --- Top-level screen switcher, flattened onto the root. Game's internal stages stay out of it. ---
  const screenTune = {
    screen: SCREEN_SLUGS[state.screen]!,
    attract: ATTRACT_SLUGS[+(state.t >= ATTRACT_LOGO_AT)]!,
  };
  const screenController = gui
    .add(screenTune, "screen", SCREEN_SLUGS)
    .onChange((slug: string) => goToScreen(SCREEN_SLUGS.indexOf(slug) as Screen));
  const attractController = gui
    .add(screenTune, "attract", ATTRACT_SLUGS)
    .name("attract page")
    .onChange((slug: string) => goToAttractPage(ATTRACT_SLUGS.indexOf(slug)));
  // The attract-page row is only meaningful on Attract — hide it everywhere else. Runs every tick
  // (dat.GUI writes `screenTune.screen` itself on a dropdown pick, so a "screen changed" guard would
  // miss panel-driven switches); the write is skipped unless the target state actually differs.
  const attractRow = (attractController as unknown as { __li: HTMLElement }).__li;
  const syncAttractRow = (): void => {
    const want = state.screen === Screen.Attract ? "" : "none";
    if (attractRow.style.display !== want) attractRow.style.display = want;
  };
  syncAttractRow();

  // --- Level jump: go straight to a wave, which is also how you inspect a given arena form.
  // The arena cycles every 16 levels (`shape()` is `(ordinal - 1) & 15`), so 1..16 covers all of
  // them. Off the Game screen this starts a run at that level rather than doing nothing. ---
  const levelTune = { level: state.ordinal };
  const levelController = gui.add(levelTune, "level", 1, 99, 1).onChange((n: number) => setLevel(n));

  // --- Game cheats: force a level clear (fly-through to the next wave) or take one hit ---
  const cheats = { "win level": winLevel, "lose life": loseLife, "simulate +1 life": awardLife };
  gui.add(cheats, "win level");
  gui.add(cheats, "lose life");
  gui.add(cheats, "simulate +1 life");

  // --- Tube parallax: how far the vanishing point is pushed away from the player's place on the
  // rim. Positive moves it opposite the ship; negative leans it toward the ship instead. ---
  const px = gui.addFolder("parallax");
  px.add(tune, "parallax", -0.6, 0.6, 0.01).name("lean away");
  px.add(tune, "parallaxMs", 30, 1200, 10).name("ease ms");

  // --- Attract:Logo's zoom sequence runs a fixed tick count (game/model.ts attractTitleFrame), so
  // scaling the ms-per-tick clock scales the whole animation's total runtime with it. ---
  const lg = gui.addFolder("attract logo");
  lg.add(tune, "logoTick", 10, 200, 5).name("tick ms (total time)");

  // --- Rainbow flush's own announcement flash (index.ts startFlush/updateFlush): a flat timer,
  // independent of the kill cadence, so its total length is a single knob. ---
  const fl = gui.addFolder("rainbow flush");
  fl.add(tune, "flushFlashMs", 100, 3000, 50).name("flash ms (total time)");

  // --- Beam core: the crisp line + its narrow analytic shoulder (gfx/gl.ts) ---
  const bm = gui.addFolder("beam");
  bm.add(tune, "beamGain", 0.5, 4, 0.05).name("gain").onChange(rebuildBeam);
  bm.add(tune, "haloIntensity", 0, 1, 0.02).onChange(rebuildBeam);
  bm.add(tune, "haloScale", 0, 3, 0.05).onChange(rebuildBeam);

  // --- Geometry Wars-style bloom pipeline (gfx/bloom.ts) ---
  const bl = gui.addFolder("bloom");
  bl.add(tune, "glowScale", { full: 1, half: 0.5, quarter: 0.25, eighth: 0.125 }).onChange(() => rebuildBloom());
  bl.add(tune, "passes", 0, 10, 1);
  bl.add(tune, "radius", 0.25, 1.5, 0.05); // past ~1.5 texels the 5-tap kernel ghosts — see bloom.ts
  bl.add(tune, "sourceGain", 0, 6, 0.05);
  bl.add(tune, "glowGain", 0, 4, 0.05).onChange(rebuildComposite);
  bl.add(tune, "wideGain", 0, 4, 0.05).onChange(rebuildComposite);
  bl.add(tune, "tonemap", 0, 1, 0.05).onChange(rebuildComposite);

  // --- Live readouts: plain top-left text box ---
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;top:4px;left:4px;color:#8f8;font:12px monospace;" +
    "background:rgba(0,0,0,.55);padding:4px 6px;white-space:pre;pointer-events:none;z-index:9";
  box.className = "dev-overlay";
  box.style.display = "none";
  document.body.appendChild(box);

  // --- "Open Controls" affordance shown while the panel is hidden ---
  const openTab = document.createElement("div");
  openTab.textContent = "Open Controls";
  openTab.style.cssText =
    "position:fixed;top:4px;right:4px;color:#8f8;font:12px monospace;" +
    "background:rgba(0,0,0,.55);padding:4px 6px;cursor:pointer;user-select:none;z-index:9";
  document.body.appendChild(openTab);

  /** Show or hide the whole dev panel — dat.GUI controls and the readout overlay move together. */
  const setPanel = (open: boolean): void => {
    panelOpen = open;
    gui.closed = false; // never leave the panel in dat.GUI's collapsed-bar state
    gui.domElement.style.display = open ? "" : "none";
    box.style.display = open ? "" : "none";
    openTab.style.display = open ? "none" : "";
  };

  openTab.addEventListener("click", () => setPanel(true));
  // dat.GUI's own bottom "Close Controls" bar hides the panel entirely rather than collapsing it.
  (gui as unknown as { __closeButton: HTMLElement }).__closeButton.addEventListener("click", () => setPanel(false));

  addEventListener("keydown", (event) => {
    if (event.code !== "Backquote" || event.repeat) return;
    event.preventDefault();
    setPanel(!panelOpen);
  });

  const dt: number[] = [];
  let last = performance.now();
  return () => {
    const currentScreenSlug = SCREEN_SLUGS[state.screen] ?? "?";
    if (screenTune.screen !== currentScreenSlug) {
      screenTune.screen = currentScreenSlug;
      screenController.updateDisplay();
    }
    syncAttractRow();
    // Follow the run when it advances a wave on its own, so the slider never lies about where you are.
    if (levelTune.level !== state.ordinal) {
      levelTune.level = state.ordinal;
      levelController.updateDisplay();
    }
    if (state.screen === Screen.Attract) {
      const currentAttractPage = ATTRACT_SLUGS[+(state.t >= ATTRACT_LOGO_AT)]!;
      if (screenTune.attract !== currentAttractPage) {
        screenTune.attract = currentAttractPage;
        attractController.updateDisplay();
      }
    }
    const now = performance.now();
    dt.push(now - last);
    last = now;
    if (dt.length > FPS_SAMPLES) dt.shift();
    const fps = round(1000 / (dt.reduce((a, b) => a + b, 0) / dt.length));
    box.textContent =
      `v.${__BUILD__}   fps ${fps}   seg ${segCount()}   glow ${bloomIsFloat() ? "RGBA16F" : "RGBA8"}\n` +
      `${targetName()}   lvl ${state.level}   ord ${state.ordinal}\n` +
      `lane ${state.lane} (${state.from}->${state.to} @ ${round(state.move * 100)}%)\n` +
      `music ${state.music.toFixed(2)}   beat ${state.beat}   enemies ${state.enemies.length}   pending ${state.pending.length}`;
  };
};
