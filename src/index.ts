import { runLoop } from "./core/loop";
import { initViewport, isMobile, onResize, setTouchUI, toLogicalX, toLogicalY } from "./core/viewport";
import { initDevGui } from "./dev/gui";
import { installDebugHook } from "./dev/hook";
import { SHIP, SHIP_NOSE_Z, SHIP_U, SHIP_Z } from "./game/art";
import {
  EnemyKind,
  FUSE_CHASE_TOP,
  FUSE_CHASE_TUBE,
  fuseballParams,
  fuseballRange,
  fuseballScore,
  pulsarCanFire,
  pulsarChaseDelay,
  pulsarParams,
  PulsarPhase,
  pulsarRange,
} from "./game/enemy-rules";
import {
  renderAttract,
  renderGameOver,
  renderHud,
  renderInitials,
  renderRotate,
  renderStageOverlay,
  renderStartLevelSelect,
} from "./game/hud";
import {
  arenaPoint,
  laneCount,
  laneDelta,
  moveLane,
  openArena,
  seeded,
  skillBonus,
  skillLevel,
  START_LEVEL_COUNT,
  unlockedKinds,
} from "./game/model";
import { NRANKS, names as rankNames, rankPlayer } from "./game/ranking";
import { INI_CHARS, save, saved, state, type Enemy, type Shot } from "./game/state";
import { line, point, resetXform, xform } from "./gfx/beam";
import { beginFrame, capture, endFrame, flush, glowBand, initLines, seg } from "./gfx/lines";
import { flushFlashMs, parallax, parallaxMs } from "./gfx/tune";
import { CENTER_X, CENTER_Y, FAR, NEAR, relayout, rhythmY, rotateLocked, VANISH_Y, vw } from "./layout";
import { createSynth } from "./music/synth";
import { judgeBeat } from "./rhythm/judge";
import { Screen, Stage } from "./scenes/modes";
import "./styles.css";
import {
  ATTRACT_LOGO_AT,
  BEAT,
  BOUNCE_AMOUNT,
  BOUNCE_GLOW,
  COL,
  COL_CYAN,
  COL_GREEN,
  COL_MAGENTA,
  COL_PLAYER,
  COL_RED,
  COL_STAR,
  COL_WHITE,
  COL_YELLOW,
  DOUBLE_MS,
  EDGE_PAD,
  ENTRY_BEATS,
  eshotCap,
  eshotHoldoff,
  EXTRA_LIFE,
  FIRE_MS,
  FLIGHT_ACCEL,
  FLIGHT_BURST_AT,
  FLIGHT_BURST_MS,
  FLIGHT_INITIAL_SPEED,
  FLUSH_CHARGES,
  FLUSH_FLASH_STEP,
  FLUSH_TICK,
  GAMEOVER_MS,
  GRID_GLOW,
  HIT,
  HUD_GLOW,
  LIFE_FLASH_MS,
  MAX_LIVES,
  MAX_SHOTS,
  MISS_HOLD,
  MOVE_MS,
  playerShotColour,
  RHYTHM_H,
  RHYTHM_MARKER,
  SCORE,
  SELECT_BLINK_MS,
  SELECT_FLASH_MS,
  SHARD_MS,
  SHARD_SPEED,
  SHARD_SPIN,
  SHIP_GLOW,
  SHOT_SPEED,
  STAR_CAM,
  STAR_COUNT,
  STAR_FAR,
  STAR_FOCAL,
  STAR_NEAR,
  STAR_RATE,
  STAR_SPREAD,
  STAR_START_FRAC,
  START_LIVES,
  STEP,
  SWARM_MAX,
  SWARM_Q0,
  SWARM_RATE,
  SWARM_SPIN,
  SWIPE_MIN,
  TUBE_SCALE_BURST,
  TUBE_SCALE_MAX,
  WEB_W,
} from "./tuning";

initLines(initViewport());

// The logical drawing space is BASE-pinned (core/viewport.ts), so these mirror the *logical*
// viewport, not the pixel one; they stay plain locals rather than layout's live bindings because
// the draw code reads them dozens of times a frame.
relayout();
let W = vw;
onResize(() => {
  relayout(state.screen === Screen.Game);
  W = vw;
});

type InputEvent = { d: number; t: number };

let rand = seeded(1);
let nextEnemyId = 1;
/** A lane remains live until its last active Pulsar releases it. */
const electricLanes = new Map<number, Set<number>>();

const synth = createSynth(saved.vol);
const { unlock, tone } = synth;

const inputs: InputEvent[] = [];
let action = false;
let flushPress = false;
/** A menu's in-flight touch gesture and where it began, in logical px. */
let swipeId = -1;
let swipeX = 0;
let swipeY = 0;
/** The timestamp of the last touch tap during Play — a second one inside DOUBLE_MS is a rainbow
 *  flush instead of a steer (see the `pointerdown` handler). */
let lastTap = -DOUBLE_MS;
const eventTime = (stamp: number): number => state.music + (stamp - performance.now()) / 1000;
const press = (direction: number, stamp: number): void => {
  unlock();
  if (direction) inputs.push({ d: direction, t: eventTime(stamp) });
};
const editInitials = (position: number, character: number): void => {
  if (position) state.iniIndex = (state.iniIndex + position + 3) % 3;
  if (character)
    state.iniChars[state.iniIndex] =
      (state.iniChars[state.iniIndex]! + character + INI_CHARS.length) % INI_CHARS.length;
};
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  setTouchUI(false); // a keypress is the clearest signal the player is not on touch right now
  // Backquote belongs exclusively to the dev panel; in release it follows the same any-key rule.
  if (__DEBUG__ && e.code === "Backquote") return;
  const direction =
    e.code === "ArrowLeft" || e.code === "KeyA" ? -1 : e.code === "ArrowRight" || e.code === "KeyD" ? 1 : 0;
  // Passive screens advance on every desktop key. Start-Level Select and Initials keep their own
  // navigation keys and accept only Space.
  if (state.screen !== Screen.Game) {
    if (state.screen === Screen.StartLevelSelect) {
      press(direction, e.timeStamp);
      if (e.code === "Space") action = true;
    } else if (state.screen === Screen.Initials) {
      press(0, e.timeStamp);
      editInitials(
        e.code === "ArrowLeft" ? -1 : e.code === "ArrowRight" ? 1 : 0,
        e.code === "ArrowUp" ? 1 : e.code === "ArrowDown" ? -1 : 0,
      );
      if (e.code === "Space") action = true;
    } else {
      press(0, e.timeStamp);
      action = true;
    }
    e.preventDefault();
    return;
  }
  // While paused, any key resumes.
  if (state.stage === Stage.Pause) {
    togglePause();
    e.preventDefault();
    return;
  }
  if (direction) press(direction, e.timeStamp);
  else if (e.code === "Space" || e.code === "Enter") {
    press(0, e.timeStamp);
    action = true;
  } else if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "KeyX") {
    press(0, e.timeStamp);
    flushPress = true;
  } else if (e.code === "KeyP" || e.code === "Escape") {
    press(0, e.timeStamp);
    togglePause();
  } else if (e.code === "KeyM") {
    unlock();
    saved.vol = saved.vol ? 0 : 0.22;
    synth.volume(saved.vol);
    save();
  }
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
});
// Touch scheme (the canvas fills the viewport, so client space maps to logical space with no
// origin offset): during play the whole screen is a left/right steer, and a second tap inside
// DOUBLE_MS deploys a rainbow flush instead — the same two-button grammar the keyboard gets, minus
// a fire button, because firing is automatic. Start-Level Select and Initials use swipe-and-tap;
// elsewhere a tap is just "confirm".
c.addEventListener("pointerdown", (e) => {
  if (rotateLocked) return;
  // The pointer path is touch-exclusive: on desktop every screen, Game included, is driven by
  // keyboard only, so a mouse press is ignored entirely.
  if (e.pointerType === "mouse") return;
  setTouchUI(true);
  // Selection and initials answer to a finger, never to a mouse. A short gesture confirms; a
  // swipe edits the highlighted level, initials position, or initials character.
  if (state.screen === Screen.StartLevelSelect || state.screen === Screen.Initials) {
    swipeId = e.pointerId;
    swipeX = toLogicalX(e.clientX);
    swipeY = toLogicalY(e.clientY);
    return;
  }
  const x = toLogicalX(e.clientX);
  const playing = inPlay();
  if (playing) {
    // A lone tap steers toward its side and is judged normally. A second tap landing inside the
    // double-tap window is a flush instead: it does not steer and is unjudged (`press(0, …)` posts
    // no direction), so spending a charge can never read as a miss. A third tap starts a fresh
    // pair rather than chaining another flush.
    if (e.timeStamp - lastTap < DOUBLE_MS) {
      lastTap = -DOUBLE_MS;
      press(0, e.timeStamp);
      flushPress = true;
    } else {
      lastTap = e.timeStamp;
      press(x < W / 2 ? -1 : 1, e.timeStamp);
    }
  } else {
    press(0, e.timeStamp);
    action = true;
  }
});
// The other half of the touch selection scheme: travel past SWIPE_MIN edits in the swipe
// direction; anything shorter is a tap and confirms. One gesture can only have one outcome.
c.addEventListener("pointerup", (e) => {
  if (e.pointerId !== swipeId) return;
  swipeId = -1;
  if (rotateLocked || (state.screen !== Screen.StartLevelSelect && state.screen !== Screen.Initials)) return;
  const dx = toLogicalX(e.clientX) - swipeX;
  const dy = toLogicalY(e.clientY) - swipeY;
  if (state.screen === Screen.Initials && Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_MIN) {
    press(0, e.timeStamp);
    if (Math.abs(dx) > Math.abs(dy)) editInitials(-Math.sign(dx), 0);
    else editInitials(0, -Math.sign(dy));
  } else if (state.screen === Screen.StartLevelSelect && Math.abs(dx) >= SWIPE_MIN) press(-Math.sign(dx), e.timeStamp);
  else {
    press(0, e.timeStamp);
    action = true;
  }
});
/** The arena form behind the current screen: the offered level while selecting a start level,
 *  otherwise the run's own level shape. Attract has no arena. */
const shape = (): number =>
  state.screen === Screen.StartLevelSelect ? (state.selected - 1) & 15 : (state.ordinal - 1) & 15;
const ownerLane = (): number => (state.move < 0.5 ? state.from : state.to);
/** Live gameplay: Play plus the level fly-out, which keeps enemies, shots and the gun alive. */
const inPlay = (): boolean =>
  state.screen === Screen.Game && (state.stage === Stage.Play || state.stage === Stage.Flight);
const startMove = (d: number): void => {
  if (state.move < 1) return;
  state.from = state.lane;
  state.to = moveLane(state.lane, d, shape());
  state.move = 0;
};
const judgeInput = (): void => {
  if (!inputs.length) return;
  let d = 0;
  let t = inputs[0]!.t;
  while (inputs.length) {
    const e = inputs.shift()!;
    t = e.t;
    if (!d) d = e.d;
    else if (d !== e.d) d = 0;
  }
  if (!d) return;
  const j = judgeBeat(t, state.consumed, HIT, BEAT);
  if (j.hit) {
    state.consumed = j.beat;
    state.hitFlash = state.music;
    startMove(d);
    tone(660, 0.05, "sine", 0.025);
  } else {
    state.hold = MISS_HOLD;
    state.missFlash = state.music;
    tone(70, 0.12, "sawtooth", 0.03);
  }
};

const waveKind = (): number => {
  // Ordinary allocation never leaks special types outside their own wave tables.
  const n = Math.min(3, unlockedKinds(state.level));
  return Math.min(n - 1, (rand() * n * 1.3) | 0);
};
/** Wave data only — pending queue, entities, spikes, lane. Callers decide what stage this
 *  belongs to (`enterEntry` for a real run). */
const setupWave = (ordinal: number): void => {
  state.ordinal = ordinal;
  state.level = Math.min(99, ordinal);
  rand = seeded(ordinal * 7919);
  state.pending.length = 0;
  state.enemies.length = 0;
  frags.length = 0;
  state.shots.length = 0;
  state.eshots.length = 0;
  electricLanes.clear();
  state.spikes.fill(1);
  state.swarmQ.fill(0);
  const total = 6 + Math.min(30, (ordinal * 0.7) | 0);
  const reserve = (kind: number, range: { min: number; max: number }): void => {
    const count = range.min + ((rand() * (range.max - range.min + 1)) | 0);
    for (let i = 0; i < count; i++) state.pending.push(kind);
  };
  reserve(EnemyKind.Fuseball, fuseballRange(ordinal));
  reserve(EnemyKind.Pulsar, pulsarRange(ordinal));
  while (state.pending.length < total) state.pending.push(waveKind());
  // Shuffle the already deterministic queue so mandatory enemy counts do not arrive as one block.
  for (let i = state.pending.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [state.pending[i], state.pending[j]] = [state.pending[j]!, state.pending[i]!];
  }
  state.flush = FLUSH_CHARGES;
  state.flushT = 0;
  state.flushFlash = 0;
  // The ship is off screen (past FLIGHT_BURST_AT) by the time this runs, so the reset is invisible —
  // it should be, not a glide: Entry's new tunnel arrives around a stationary ship, not the other
  // way round.
  state.lane = state.from = state.to = 0;
  state.move = 1;
  state.t = 0;
};
const enterEntry = (ordinal: number): void => {
  setupWave(ordinal);
  state.stage = Stage.Entry;
};

const startGame = (level = state.selected): void => {
  state.score = 0;
  state.startLevel = level;
  state.lives = START_LIVES;
  state.lifeFlash = 0;
  state.music = 0;
  state.beat = -1;
  state.consumed = -99;
  // These are absolute music timestamps; `music` restarts at 0, so a previous run's values would
  // otherwise read as "in the future" — leaving the player invulnerable and the rhythm marker
  // stuck on its hit/miss colour at the start of the new run.
  state.protect = 0;
  state.hitFlash = state.missFlash = -9;
  state.rank = 0;
  // Ranking population grows when a game STARTS, not at Game Over.
  saved.ngames = Math.min(NRANKS, saved.ngames + 1);
  save();
  state.screen = Screen.Game;
  enterEntry(level);
};
/** Every enemy enters the same way: at rest, at its spawn depth, with a fresh fire cooldown. */
const addEnemy = (k: number, l: number, z: number, d: number): void => {
  state.enemies.push({
    id: nextEnemyId++,
    k,
    l,
    z,
    pz: z,
    s: 0,
    t: 0,
    d,
    fire: eshotHoldoff(state.ordinal, rand()),
    mode: k === EnemyKind.Pulsar ? PulsarPhase.Safe : 0,
    phase: 0,
    source: l,
    target: l,
    electric: false,
    cargo:
      k === EnemyKind.Tanker
        ? state.level >= 33
          ? rand() < 0.5
            ? EnemyKind.Fuseball
            : EnemyKind.Pulsar
          : state.level >= 17
            ? EnemyKind.Pulsar
            : EnemyKind.Flipper
        : EnemyKind.Flipper,
  });
};
const releasePulsarLane = (e: Enemy): void => {
  if (!e.electric) return;
  const owners = electricLanes.get(Math.round(e.l));
  owners?.delete(e.id);
  if (!owners?.size) electricLanes.delete(Math.round(e.l));
  e.electric = false;
};
const acquirePulsarLane = (e: Enemy): void => {
  if (e.electric) return;
  const lane = Math.round(e.l);
  let owners = electricLanes.get(lane);
  if (!owners) electricLanes.set(lane, (owners = new Set()));
  owners.add(e.id);
  e.electric = true;
};
const releaseTanker = (e: Enemy): void => {
  // Every specialist Tanker releases two real enemies at its own depth. Fuseballs begin on the
  // two rails bordering the Tanker's corridor; Pulsars occupy the neighbouring corridors.
  for (let i = 0; i < 2; i++) {
    const dir = i ? 1 : -1;
    const l =
      e.cargo === EnemyKind.Fuseball
        ? moveRail(Math.round(e.l) + (i ? 1 : 0), 0)
        : moveLane(Math.round(e.l), dir, shape());
    addEnemy(e.cargo, l, e.z, dir);
  }
};
/** Award a bonus shooter if there is room and announce it at the centre of the playfield. */
const awardLife = (): void => {
  if (state.lives >= MAX_LIVES) return;
  state.lives++;
  state.lifeFlash = LIFE_FLASH_MS;
};
/** The one scoring entry point: it awards points and a bonus shooter on each crossed threshold. */
const addScore = (n: number): void => {
  const before = (state.score / EXTRA_LIFE) | 0;
  state.score += n;
  if (((state.score / EXTRA_LIFE) | 0) > before) awardLife();
};
const removeEnemy = (index: number, byFlush = false): void => {
  const e = state.enemies[index]!;
  if (e.k === 1 && !byFlush) releaseTanker(e);
  if (e.k === EnemyKind.Pulsar) releasePulsarLane(e);
  // Calm the figure before the shatter replays it: an active Pulsar's mode would otherwise draw its
  // two rails all the way to the near rim, and a mid-jump Fuseball would re-derive a rail position
  // that is about to stop mattering — `mode` means nothing to the other three kinds.
  e.mode = 0;
  burst(() => drawEnemy(e));
  addScore(e.k === EnemyKind.Fuseball ? fuseballScore(e.z) : e.k === EnemyKind.Pulsar ? 200 : SCORE[e.k]!);
  state.enemies.splice(index, 1);
  tone(150 + e.k * 45, 0.09, "sawtooth", 0.025);
};
const hurt = (flight = false): void => {
  if (state.protect > state.music) return;
  if (state.stage === Stage.Death) return;
  // Before `state.stage` flips to Death: `drawShip` itself reads `state.stage` to pick its
  // projection (`rimPointRaw` mid-Flight, `rimPoint` otherwise), so the shatter has to run while
  // that still reflects what was actually on screen this death.
  burst(() => drawShip(1, 1));
  state.lives--;
  // Clear both shot pools on a life loss: a leftover enemy shot must not carry into the death
  // pause, and a leftover player shot must not score a kill after the ship is gone.
  state.eshots.length = 0;
  state.shots.length = 0;
  // A death ends any running rainbow flush without refunding it — `setupWave` is the only recharge.
  state.flushT = 0;
  state.flushLeft = 0;
  state.flushFlash = 0;
  state.lifeFlash = 0;
  state.t = 0;
  state.flightDeath = flight;
  // A death during Flight interrupts the whole transition, star field included (harmless no-op if
  // the field was already off, e.g. a death during ordinary Play).
  stopStars();
  // Set unconditionally, even at zero lives: the Game screen always leaves through Death, so the
  // recorded stage never lags behind the recorded screen.
  state.stage = Stage.Death;
  if (!state.lives) state.screen = Screen.GameOver;
  tone(45, 0.5, "sawtooth", 0.06);
};
const startFlush = (): void => {
  if (state.screen !== Screen.Game || state.stage !== Stage.Play || !state.flush) return;
  state.flush--;
  // The first charge clears the arena, the second takes a single enemy. `flush` has already been
  // decremented, so it reads 1 on the first press.
  state.flushLeft = state.flush ? state.enemies.length : Math.min(1, state.enemies.length);
  // One silent tick, then one kill per tick: the kill sequence outlives the last kill by a tick,
  // and a press into an empty arena still runs once for the charge it spent.
  state.flushT = FLUSH_TICK * (state.flushLeft + 1);
  // The rainbow announcement is a flat, fixed-length timer, deliberately independent of flushT —
  // see gfx/tune.ts flushFlashMs. Every press gets the same readable flash, whether it clears ten
  // enemies or one.
  state.flushFlash = flushFlashMs();
  tone(880, state.flushT, "sine", 0.06); // the cue is the deployment, so the second charge is shorter
};
/**
 * One rainbow-flush deployment, ticked on the musical clock: at most one kill per FLUSH_TICK, none
 * in the step of the press itself. Driven by elapsed ms in a while-loop, so the kill count cannot
 * change with the display's refresh rate. The victim is always `enemies[0]` — no `rand()` draw, so
 * using a flush cannot shift the wave's own spawn sequence.
 */
const updateFlush = (dt: number): void => {
  // The rainbow flash decays on its own flat clock, whether or not a kill sequence is still
  // running — see gfx/tune.ts flushFlashMs.
  state.flushFlash = Math.max(0, state.flushFlash - dt);
  if (state.flushT <= 0) return;
  state.flushT -= dt / 1000;
  while (state.flushLeft > 0 && state.flushT <= state.flushLeft * FLUSH_TICK && state.enemies.length) {
    removeEnemy(0, true);
    state.flushLeft--;
  }
  if (state.flushT <= 0 || !state.enemies.length) {
    state.flushT = 0;
    state.flushLeft = 0;
  }
};

const spawn = (): void => {
  const cap = Math.min(8, 3 + ((state.ordinal / 8) | 0));
  // While a flush deploys, the wave's pending population is PAUSED, never destroyed —
  // `pending.shift()` below is simply skipped, not drained, so the wave still owes the same count
  // once the deployment ends.
  if (!state.pending.length || state.enemies.length >= cap || state.flushT > 0) return;
  const k = state.pending.shift()!;
  const l = (rand() * laneCount(shape())) | 0;
  addEnemy(k, l, 1, rand() > 0.5 ? 1 : -1);
  // The far-end swarm (`updateSwarm`) only ever births a point, never kills one for being over
  // target — this is the one place a slot is freed, paired one-for-one with the `shift` above so the
  // swarm empties itself exactly when `pending` does (load-bearing for Stage.Flight, which assumes
  // the far end is clear by the time it runs). Free the most-settled point: the one closest to the
  // rim reads as the enemy that just arrived.
  let best = -1;
  let bestQ = 0;
  for (let i = 0; i < SWARM_MAX; i++) {
    if (state.swarmQ[i]! > bestQ) {
      bestQ = state.swarmQ[i]!;
      best = i;
    }
  }
  if (best >= 0) state.swarmQ[best] = 0;
};
const shortest = (from: number, to: number): number => Math.sign(laneDelta(from, to, shape())) || 1;
const moveRail = (rail: number, direction: number): number => {
  const next = Math.round(rail) + direction;
  return openArena(shape()) ? Math.max(0, Math.min(15, next)) : ((next % 16) + 16) % 16;
};
const shortestRail = (from: number, to: number): number => {
  if (openArena(shape())) return Math.sign(to - from) || 1;
  const d = ((to - from + 24) % 16) - 8;
  return Math.sign(d) || 1;
};
/** The one corridor crossed by a Fuseball's adjacent-rail leap. */
const fuseJumpLane = (e: Enemy): number => {
  const a = Math.round(e.source);
  const b = Math.round(e.target);
  return a === 15 && b === 0 ? 15 : a === 0 && b === 15 ? 15 : Math.min(a, b);
};
const beginFuseJump = (e: Enemy, direction: number, top = false): void => {
  const source = Math.round(e.l);
  let target = moveRail(source, direction);
  if (target === source) target = moveRail(source, -direction);
  if (target === source) return;
  e.source = source;
  e.target = target;
  e.d = target === source ? direction : target === moveRail(source, 1) ? 1 : -1;
  e.t = 0;
  e.mode = top ? 3 : 1;
};
const onBeat = (beat: number): void => {
  synth.beat(beat);
  const active = inPlay();
  if (active) {
    if (!(beat & 1)) spawn();
    // Enemy fire is per-enemy, not one global roll per beat: each enemy runs its own `fire` beat
    // countdown, and when it reaches zero it fires only if the shared cap has a free slot —
    // otherwise the countdown stays at/under zero and the shot leaves the instant a slot opens.
    const cap = eshotCap(state.ordinal);
    for (const e of state.enemies) {
      if (e.k === 0 && e.s !== 1) {
        // On the rim, only flip toward the player's lane (a discrete step of the chase, not the
        // tube's coin flip) and only when actually misaligned. In the tube, the first shape of every
        // 16-level cycle (Circle) never lane-flips at all.
        const rim = e.z <= 0;
        const l = Math.round(e.l);
        if (rim ? l !== ownerLane() : shape() !== 0) {
          e.s = 1;
          e.t = 0;
          e.d = rim ? shortest(l, ownerLane()) : rand() > 0.5 ? 1 : -1;
        }
      } else if (e.k === EnemyKind.Fuseball && (e.mode === 0 || e.mode === 2)) {
        const params = fuseballParams(state.ordinal);
        if (rand() * 256 < params.threshold) {
          const chase = e.mode === 2 ? params.chase & FUSE_CHASE_TOP : params.chase & FUSE_CHASE_TUBE;
          const direction = chase ? shortestRail(Math.round(e.l), ownerLane()) : rand() > 0.5 ? 1 : -1;
          beginFuseJump(e, direction, e.mode === 2);
        }
      }
      const canFire = e.k !== EnemyKind.Fuseball && (e.k !== EnemyKind.Pulsar || pulsarCanFire(state.ordinal));
      if (canFire && --e.fire <= 0 && e.z > 0.08 && state.eshots.length < cap) {
        state.eshots.push({ l: Math.round(e.l), z: e.z, pz: e.z });
        e.fire = eshotHoldoff(state.ordinal, rand());
      }
    }
  }
};

const updateEnemies = (dt: number): void => {
  const sec = dt / 1000;
  const speed = 0.065 + Math.min(0.1, state.ordinal / 900);
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i]!;
    e.pz = e.z;
    if (e.k === 0) {
      if (e.s === 1) {
        e.t += sec / 0.18;
        e.l += (e.d * sec) / 0.18;
        if (e.t >= 1) {
          e.l = moveLane(Math.round(e.l - e.d), e.d, shape());
          e.s = 0;
        }
      } else e.z -= speed * sec;
      if (e.z <= 0) e.z = 0;
    } else if (e.k === 1) {
      e.z -= speed * 0.65 * sec;
      if (e.z <= 0) {
        releaseTanker(e);
        state.enemies.splice(i, 1);
        continue;
      }
    } else if (e.k === 2) {
      if (!e.s) {
        e.z -= speed * 0.72 * sec;
        const l = Math.round(e.l);
        state.spikes[l] = Math.min(state.spikes[l]!, e.z);
        if (e.z < 0.34) e.s = 1;
      } else {
        e.z += speed * 1.4 * sec;
        if (e.z >= 1) {
          if (state.pending.length) {
            e.z = 1;
            e.s = 0;
            e.l = (rand() * laneCount(shape())) | 0;
          } else {
            e.k = 1;
            e.s = 0;
            e.z = 0.85;
          }
        }
      }
    } else if (e.k === 3) {
      const fuse = fuseballParams(state.ordinal);
      if (e.mode === 1 || e.mode === 3) {
        // A leap crosses the corridor centre continuously. `l` is only a render convenience;
        // source/target remain the authoritative rails used by collision and topology.
        e.t += sec / 0.24;
        const d = shortestRail(e.source, e.target);
        e.l = e.source + d * Math.min(1, e.t);
        if (e.mode === 1) e.z = Math.max(0, e.z - speed * fuse.speedScale * sec);
        if (e.t >= 1) {
          e.l = e.target;
          e.mode = e.z <= 0 ? 2 : 0;
          e.t = 0;
        }
      } else if (e.mode === 0) {
        // Fuseballs ride a rail at 2× the effective invader speed, never down a lane centre.
        e.z -= speed * fuse.speedScale * sec;
        if (e.z <= 0) {
          e.z = 0;
          e.mode = 2;
        }
      }
    } else {
      const params = pulsarParams(state.ordinal);
      if (e.z > 0) {
        e.phase = (e.phase + sec * params.rate) % 8;
        const nextMode =
          e.phase < 6
            ? PulsarPhase.Safe
            : e.phase < 6.75
              ? PulsarPhase.Warning
              : e.phase < 7.3
                ? PulsarPhase.Active
                : PulsarPhase.Recovery;
        if (nextMode === PulsarPhase.Active) acquirePulsarLane(e);
        else releasePulsarLane(e);
        e.mode = nextMode;
        e.z -= speed * (nextMode === PulsarPhase.Warning ? 0.45 : 0.85) * sec;
        if (e.z <= 0) {
          e.z = 0;
          releasePulsarLane(e);
          e.mode = PulsarPhase.RimChase;
          e.t = pulsarChaseDelay(state.ordinal);
        }
      } else if (e.mode === PulsarPhase.RimFlip) {
        e.t += sec / 0.2;
        e.l = e.source + shortest(e.source, e.target) * Math.min(1, e.t);
        if (e.t >= 1) {
          e.l = e.target;
          e.mode = PulsarPhase.RimChase;
          e.t = pulsarChaseDelay(state.ordinal);
        }
      } else {
        e.t -= sec;
        if (e.t <= 0 && Math.round(e.l) !== ownerLane()) {
          e.source = Math.round(e.l);
          e.target = moveLane(e.source, shortest(e.source, ownerLane()), shape());
          e.mode = PulsarPhase.RimFlip;
          e.t = 0;
        }
      }
    }
    // A Flipper's lane rounds over to the player halfway through its swing, well before the gate
    // is visually shut — hold the contact kill for the tail of the swing so a shot on time still
    // catches it, instead of losing a life to a foot that is still mid-air.
    const gateShut = e.k !== 0 || e.s !== 1 || e.t > 0.8;
    const fuseContact =
      e.k === EnemyKind.Fuseball &&
      e.z <= 0.025 &&
      (Math.round(e.l) === ownerLane() || Math.round(e.l) === ownerLane() + 1);
    const contact = e.k === EnemyKind.Fuseball ? fuseContact : e.z <= 0.025 && Math.round(e.l) === ownerLane();
    if (contact && gateShut) hurt();
  }
  // Pulsar electricity is lane-wide, so it must be checked after movement every simulation tick:
  // both an activated lane and a player entering an already-active lane are lethal.
  if (electricLanes.has(ownerLane())) hurt();
};

/** Do the swept z-ranges `[a1,a2]` and `[b1,b2]` from this step overlap? A player shot and an enemy
 *  shot both move every step and toward each other, so testing one's current point against the
 *  other's range lets the faster one tunnel clean through between frames — the shot "flies past"
 *  the bullet without stopping it. Overlapping the whole swept ranges catches the crossing.
 *  A stationary target (a spike tip) is passed as a zero-length sweep — `sweepsCross(a, b, x, x)`
 *  reduces to "is x between a and b", so this one test covers both cases. */
const sweepsCross = (a1: number, a2: number, b1: number, b2: number): boolean =>
  Math.max(a1, a2) >= Math.min(b1, b2) && Math.max(b1, b2) >= Math.min(a1, a2);
const updateShots = (dt: number): void => {
  const sec = dt / 1000;
  for (let i = state.shots.length - 1; i >= 0; i--) {
    const s = state.shots[i]!;
    s.pz = s.z;
    s.z += SHOT_SPEED * sec;
    let hit = false;
    // Enemies get the first collision pass. In particular, a descending Spiker occupies the same
    // depth as the tip it is growing; testing the spike first would consume every shot at that
    // shared point, then let the Spiker restore the chipped tip on the next step.
    for (let j = state.enemies.length - 1; j >= 0; j--) {
      const e = state.enemies[j]!;
      const targetLane = e.k === EnemyKind.Fuseball && e.mode === 1 ? fuseJumpLane(e) : Math.round(e.l);
      const shootable = e.k !== EnemyKind.Fuseball || e.mode === 1;
      if (targetLane === s.l && shootable && sweepsCross(s.pz, s.z, e.pz, e.z)) {
        removeEnemy(j);
        hit = true;
        break;
      }
    }
    if (hit) {
      state.shots.splice(i, 1);
      continue;
    }
    const spike = state.spikes[s.l]!;
    if (spike < 1 && sweepsCross(s.pz, s.z, spike, spike)) {
      state.spikes[s.l] = Math.min(1, spike + 0.13);
      state.score += 2;
      state.shots.splice(i, 1);
    } else if (s.z >= 1) state.shots.splice(i, 1);
  }
  for (let i = state.eshots.length - 1; i >= 0; i--) {
    const s = state.eshots[i]!;
    s.pz = s.z;
    s.z -= (0.38 + Math.min(0.2, state.ordinal / 400)) * sec;
    let blocked = false;
    for (let j = state.shots.length - 1; j >= 0; j--) {
      const p = state.shots[j]!;
      if (p.l === s.l && sweepsCross(s.pz, s.z, p.pz, p.z)) {
        state.shots.splice(j, 1);
        blocked = true;
        break;
      }
    }
    if (blocked) state.eshots.splice(i, 1);
    else if (s.z <= 0.03) {
      if (s.l === ownerLane()) hurt();
      state.eshots.splice(i, 1);
    }
  }
};

const updateMusic = (dt: number): void => {
  state.music += dt / 1000;
  const b = Math.floor(state.music / BEAT);
  if (b !== state.beat) {
    state.beat = b;
    onBeat(b);
  }
};
const updatePlayer = (dt: number): void => {
  judgeInput();
  if (state.move < 1) {
    state.move = Math.min(1, state.move + dt / MOVE_MS);
    if (state.move >= 1) state.lane = state.to;
  }
  state.hold = Math.max(0, state.hold - dt);
  state.fire -= dt;
  const firing = inPlay();
  if (firing && state.hold <= 0 && state.fire <= 0 && state.shots.length < MAX_SHOTS) {
    state.fire = FIRE_MS;
    // Born at the horn tip, not the ship's own anchor point — `SHIP_NOSE_Z` is exactly where
    // `drawShip` projects that vertex. While flying out of a level it's born at the ship's current
    // depth instead, not the near rim, so it can still clear a spike ahead — a ship caught on a
    // spiked lane can shoot its way clear even mid fly-out.
    const z0 = state.stage === Stage.Flight ? Math.max(SHIP_NOSE_Z, state.flight) : SHIP_NOSE_Z;
    state.shots.push({ l: ownerLane(), z: z0, pz: z0 });
    tone(300, 0.035, "square", 0.012);
  }
};
const togglePause = (): void => {
  if (state.screen !== Screen.Game) return;
  if (state.stage === Stage.Pause) {
    state.stage = state.beforePause;
    state.t = 0;
    synth.resume();
  } else if (inPlay()) {
    state.beforePause = state.stage;
    state.stage = Stage.Pause;
    synth.pause();
  }
};

const runPlaySimulation = (dt: number): void => {
  updateMusic(dt);
  updatePlayer(dt);
  if (flushPress) startFlush();
  updateFlush(dt);
  updateEnemies(dt);
  updateShots(dt);
  if (!state.pending.length && !state.enemies.length) advanceWave();
};
const advanceWave = (): void => {
  if (state.level === state.startLevel) addScore(skillBonus(state.startLevel));
  state.stage = Stage.Flight;
  state.t = 0;
  state.flight = 0;
  state.flightSpeed = FLIGHT_INITIAL_SPEED;
  burstMs = -1;
  // Flight never ticks updateFlush, so both timers have to be zeroed here rather than left to
  // decay — this also guards debugWinLevel, which enters Flight directly.
  state.flushT = 0;
  state.flushFlash = 0;
  // The cleared wave's own enemy shots would otherwise hang frozen on screen through the whole
  // fly-out — nothing updates eshots once Stage.Flight begins.
  state.eshots.length = 0;
  // Descent cue: one falling sweep for the whole fly-out, not several discrete notes.
  tone(900, 0.5, "sawtooth", 0.05, 0, 90);
};

// DEV cheats, wired to the dev panel from the `if (__DEBUG__)` branch near the bottom — that branch
// is dead in a release build, so these tree-shake out. Defined here for the stage transitions.
const debugWinLevel = (): void => {
  if (state.screen !== Screen.Game) return;
  state.pending.length = 0;
  state.enemies.length = 0;
  state.shots.length = 0;
  state.eshots.length = 0;
  // A leftover spike is left standing, same as a real wave-clear — a spike still live at this
  // point is exactly the case that needs exercising through the fly-out, so the cheat should not
  // paper over it.
  advanceWave();
};
/** Jump the run straight to a wave — the fastest way to inspect a particular arena form. */
const debugSetLevel = (ordinal: number): void => {
  if (state.screen === Screen.Game) {
    enterEntry(ordinal);
    // Otherwise jumping back onto the run's own start level and clearing it would re-award the
    // Skill-Step bonus (`advanceWave` pays it once per run, keyed on `state.level === startLevel`).
    state.startLevel = 0;
  } else startGame(ordinal);
};
const debugLoseLife = (): void => {
  if (state.screen !== Screen.Game) return;
  state.protect = 0; // skip entry invulnerability so the button always bites
  hurt();
};
/** Advance the score to its next bonus threshold, exercising the ordinary award path. */
const debugAwardLife = (): void => {
  if (state.screen !== Screen.Game) return;
  addScore(EXTRA_LIFE - (state.score % EXTRA_LIFE));
};

// --- Screen/stage transitions ---

const enterAttract = (): void => {
  state.screen = Screen.Attract;
  state.t = 0;
};
const enterStartLevelSelect = (): void => {
  state.screen = Screen.StartLevelSelect;
  state.t = 0;
  state.selectedIndex = Math.max(0, Math.min(START_LEVEL_COUNT - 1, state.selectedIndex | 0));
  state.selected = skillLevel(state.selectedIndex);
  // Normally already 0 by the time this screen is re-entered — the only way it goes non-zero is
  // the confirm flash, which always ends by leaving the screen. Zeroed here too so a dev-tool
  // screen jump mid-flash can't strand it running.
  state.selFlash = 0;
};
/** Enter a top-level screen through the same setup paths for startup, normal flow, and DEV tools. */
const goToScreen = (screen: Screen): void => {
  inputs.length = 0;
  action = flushPress = false;
  synth.resume();
  switch (screen) {
    case Screen.Attract:
      enterAttract();
      break;
    case Screen.StartLevelSelect:
      enterStartLevelSelect();
      break;
    case Screen.Game: {
      state.selected = skillLevel(state.selectedIndex);
      startGame(state.selected);
      break;
    }
    case Screen.GameOver:
      state.screen = Screen.GameOver;
      state.t = 0;
      break;
    case Screen.Initials:
      state.iniIndex = 0;
      state.iniChars = [0, 0, 0];
      state.screen = Screen.Initials;
      state.t = 0;
      break;
  }
};
/** Select a timed page within Attract and restart that page's hold. */
const goToAttractPage = (page: number): void => {
  goToScreen(Screen.Attract);
  if (page) state.t = ATTRACT_LOGO_AT;
};

const enterConfiguredStart = (): void => {
  const screen = __START_TARGET__.screen as Screen;
  if (screen === Screen.Attract) {
    goToAttractPage(__START_TARGET__.sub);
    return;
  }

  goToScreen(screen);
  if (screen !== Screen.Game || __START_TARGET__.sub === Stage.Entry) return;

  state.stage = __START_TARGET__.sub as Stage;
  state.t = 0;
  if (state.stage === Stage.Flight) {
    state.flight = 0;
    state.flightSpeed = FLIGHT_INITIAL_SPEED;
    burstMs = -1;
  }
  if (state.stage === Stage.Pause) {
    state.beforePause = Stage.Play;
    synth.pause();
  }
};
const updateAttract = (): void => {
  if (action) enterStartLevelSelect();
};
const updateStartLevelSelect = (dt: number): void => {
  // A confirmed choice holds on a blinking readout (`game/hud.ts` renderStartLevelSelect) for
  // SELECT_FLASH_MS before the level actually starts — dropping any input queued in the meantime,
  // so a tap landing during the flash cannot leak into the level it starts as a stray lane change.
  if (state.selFlash > 0) {
    state.selFlash -= dt;
    inputs.length = 0;
    if (state.selFlash <= 0) startGame(state.selected);
    return;
  }
  if (inputs.length) {
    let d = 0;
    while (inputs.length) d += inputs.shift()!.d;
    state.selectedIndex = (state.selectedIndex + Math.sign(d) + START_LEVEL_COUNT) % START_LEVEL_COUNT;
    state.selected = skillLevel(state.selectedIndex);
  }
  // No timeout: Start-Level Select waits for a deliberate choice. Attract owns unattended flow.
  // The confirm chime is an authored ascending arpeggio, not a port — a nod to the stylistic
  // language of an 8-bit level-select jingle (e.g. Super Mario Bros), scheduled on the audio
  // clock (`music/synth.ts` tone's `delay`) rather than four separate frame-timed calls. Its notes
  // land SELECT_BLINK_MS apart — the same constant the confirm flash's colour toggle uses
  // (`game/hud.ts` renderStartLevelSelect) — so the blink pulses in step with the notes.
  if (action) {
    state.selFlash = SELECT_FLASH_MS;
    const step = SELECT_BLINK_MS / 1000;
    tone(523, 0.09, "square", 0.05);
    tone(659, 0.09, "square", 0.05, step);
    tone(784, 0.09, "square", 0.05, step * 2);
    tone(1047, 0.16, "square", 0.05, step * 3);
  }
};
const updateGameScreen = (dt: number): void => {
  updateStars(dt);
  updateFrags(dt);
  updateSwarm(dt);
  switch (state.stage) {
    case Stage.Entry:
      updateMusic(dt);
      if (state.t >= ENTRY_BEATS * BEAT * 1000) {
        state.stage = Stage.Play;
        state.t = 0;
        state.protect = state.music + ENTRY_BEATS * BEAT;
        // Arrival cue: the incoming tunnel has just reached its resting scale.
        tone(660, 0.1, "square", 0.05, 0, 1320);
      }
      break;

    case Stage.Play:
      runPlaySimulation(dt);
      break;

    case Stage.Death:
      for (const e of state.enemies) e.z = Math.min(1, e.z + dt / 700);
      if (state.t > 800) {
        if (state.flightDeath) enterEntry(state.ordinal + 1);
        else {
          state.stage = Stage.Play;
          state.t = 0;
          state.protect = state.music + ENTRY_BEATS * BEAT;
          state.lane = state.from = state.to = 0;
          state.move = 1;
        }
      }
      break;

    case Stage.Flight: {
      updateMusic(dt);
      updatePlayer(dt);
      // Before the spike test, not after: a shot that clears the spike on this lane this same
      // step has to be able to avert the fly-out death.
      updateShots(dt);
      const old = state.flight;
      // Accelerating, not a flat rate: a flat `flight` reads as *slowing down* against `rimPoint`'s
      // hyperbolic depth projection, the opposite of being launched down the tube (tuning.ts
      // FLIGHT_INITIAL_SPEED/FLIGHT_ACCEL).
      const sec = dt / 1000;
      state.flightSpeed += FLIGHT_ACCEL * sec;
      state.flight = Math.min(1, state.flight + state.flightSpeed * sec);
      if (state.starState === 0 && state.flight >= STAR_START_FRAC) initStars();
      const spike = state.spikes[ownerLane()]!;
      if (spike < 1 && sweepsCross(old, state.flight, spike, spike)) hurt(true);
      // `flight` itself is still accelerating through this stretch, so pacing the burst on *it*
      // (rather than on elapsed real time) left only a handful of fixed steps to cover the whole
      // climb to TUBE_SCALE_BURST — a jump cut, not a fly-past. A wall-clock hold decouples the two:
      // `flight` (and so the spike/shot depth tests) keeps racing to 1 exactly as before, but Entry
      // doesn't actually start until the burst has had FLIGHT_BURST_MS of real frames to render.
      if (state.flight >= FLIGHT_BURST_AT) {
        burstMs = burstMs < 0 ? 0 : burstMs + dt;
        if (burstMs >= FLIGHT_BURST_MS) enterEntry(state.ordinal + 1);
      }
      break;
    }

    case Stage.Pause:
      inputs.length = 0;
      // Any supported input resumes: desktop keys route through the keydown handler and a touch tap
      // lands here as `action`.
      if (action) togglePause();
      break;
  }
};
const updateGameOver = (): void => {
  if (state.t > GAMEOVER_MS || action) {
    state.rank = rankPlayer(state.score);
    // Only rank 1..8 has a visible slot to fill; everything else goes straight back to Attract
    // without touching storage.
    if (state.rank < 9) {
      state.iniIndex = 0;
      state.iniChars = [0, 0, 0];
      state.screen = Screen.Initials;
    } else {
      save();
      enterAttract();
    }
    state.t = 0;
  }
};
const updateInitials = (): void => {
  if (action) {
    rankNames[state.rank - 1] = state.iniChars.map((i) => INI_CHARS[i]).join("");
    save();
    enterAttract();
  }
};

const update = (dt: number): void => {
  relayout(state.screen === Screen.Game);
  // A mobile device held sideways freezes the whole simulation — see draw's mirrored check.
  if (rotateLocked) return;
  state.t += dt;
  state.lifeFlash = Math.max(0, state.lifeFlash - dt);

  if (state.screen === Screen.Attract) {
    updateAttract();
  } else if (state.screen === Screen.StartLevelSelect) {
    updateStartLevelSelect(dt);
  } else if (state.screen === Screen.Game) {
    updateGameScreen(dt);
  } else if (state.screen === Screen.GameOver) {
    updateGameOver();
  } else if (state.screen === Screen.Initials) {
    updateInitials();
  }
  updateTubeScale();
  updateParallax(dt);

  action = flushPress = false;
};

/** The projection alone, with no transition scale applied — `updateParallax` samples this directly
 *  (see the guard in `updateParallax` below) so the scale pivot, which is itself built from
 *  `vanX`/`vanY`, can never feed back into the value that produces `vanX`/`vanY`. */
const rimPointRaw = (u: number, z: number): [number, number] => {
  const sh = shape();
  const open = openArena(sh);
  const n = laneCount(sh) + (open ? 1 : 0);
  // Not `wrapLane`: this clamps to 15, the last *vertex*, where a lane index clamps to 14.
  const v = open ? Math.max(0, Math.min(15, u)) : ((u % 16) + 16) % 16;
  const i = Math.floor(v);
  const f = v - i;
  const a = arenaPoint(sh, i % 16);
  const b = arenaPoint(sh, (i + 1) % n);
  const ux = a.x + (b.x - a.x) * f;
  const uy = a.y + (b.y - a.y) * f;
  const p = z / (0.42 + 0.58 * z);
  const nearX = CENTER_X + ux * NEAR;
  const nearY = CENTER_Y + uy * NEAR;
  // `vanX`/`vanY` push the far centre away from the player's side of the rim — the whole parallax
  // effect lives in these two terms. The near rim is untouched, so the tube's mouth stays put while
  // its far end swings.
  const farX = CENTER_X + vanX + ux * FAR;
  const farY = VANISH_Y + vanY + uy * FAR;
  return [nearX + (farX - nearX) * p, nearY + (farY - nearY) * p];
};
/** Every drawn point — arena, glyphs, shots, ship, spikes — goes through this one function, so the
 *  level-transition scale only has to be applied here to cover the whole scene. `tubeScale` is 1
 *  outside Flight/Entry, so this is a plain pass-through the rest of the time. Purely a render
 *  transform: every collision in the game is a lane-index test against a normalised depth, so no
 *  value of `tubeScale` can change what the simulation computes. */
const rimPoint = (u: number, z: number): [number, number] => {
  const [x, y] = rimPointRaw(u, z);
  if (tubeScale === 1) return [x, y];
  const px = CENTER_X + vanX;
  const py = VANISH_Y + vanY;
  return [px + (x - px) * tubeScale, py + (y - py) * tubeScale];
};

// Far-centre parallax. The vanishing point is pushed to the side of the tube opposite the player,
// so orbiting the tube swings its far end and the perspective reads as changing rather than nailed
// down. Away rather than toward is what looking down a real pipe off its axis does: standing off to
// one side, the far opening appears displaced to the other.
//
// Purely a render offset: `rimPoint` places nothing but pixels — every collision in the game is a
// lane-index test against a normalised depth — so no value of these can change what the
// simulation does.
let vanX = 0;
let vanY = 0;
/** Beat-bounce squash/stretch, as a fraction of a figure's own size — recomputed every `draw()`
 *  call straight from `state.music` (see `draw`), never smoothed or stepped, so it stays exact to
 *  wall-clock beat timing rather than frame count. Same render-only contract as `vanX`/`vanY`.
 *  Enemies always bounce on the beat; `drawShip` gets its own pair passed in, at 1 unless the
 *  player actually hit that beat (`state.consumed === state.beat`) — a miss draws no bounce, so
 *  the animation reads as feedback for landing the input, not a metronome. */
let bounceX = 1;
let bounceY = 1;
/** Lerp factor `rimPoint` applies toward the tunnel's far-plane pivot: 1 outside the transition,
 *  above 1 while Flight's descent stretches the old tunnel past its resting size, ramping 0→1
 *  while Entry's incoming tunnel grows into place. Recomputed once per step here, never inside
 *  `rimPoint` itself, which is called dozens of times a frame. */
let tubeScale = 1;
/** Real ms elapsed since `flight` first crossed `FLIGHT_BURST_AT` this Flight; -1 before that happens.
 *  Paces the burst phase below and the hold before `enterEntry` fires — both by wall-clock time, not
 *  by `flight`'s own (still accelerating) progress. Reset alongside `flight` wherever Flight starts
 *  (`advanceWave`, `enterConfiguredStart`). */
let burstMs = -1;
const updateTubeScale = (): void => {
  state.burstT = 0;
  if (state.screen !== Screen.Game) tubeScale = 1;
  else if (state.stage === Stage.Flight) {
    if (state.flight <= FLIGHT_BURST_AT) tubeScale = 1 + state.flight * (TUBE_SCALE_MAX - 1);
    else {
      // Second, much steeper phase: the far rim only ever drifted a little under TUBE_SCALE_MAX (it
      // sits close to the scale pivot by construction), so it takes an order-of-magnitude bigger
      // factor here to actually carry it — and the rest of the old tunnel — past the screen edge
      // instead of leaving it sitting on screen until the cut to Entry (tuning.ts TUBE_SCALE_BURST).
      const base = 1 + FLIGHT_BURST_AT * (TUBE_SCALE_MAX - 1);
      state.burstT = Math.min(1, Math.max(0, burstMs) / FLIGHT_BURST_MS);
      tubeScale = base + state.burstT * state.burstT * (TUBE_SCALE_BURST - base);
    }
  } else if (state.stage === Stage.Entry) tubeScale = Math.min(1, state.t / (ENTRY_BEATS * BEAT * 1000));
  else tubeScale = 1;
};

// Star field. A point's local offset from the pivot is a pure, deterministic function of its own
// index — no stored table, and stable across calls, so the field neither drifts nor rotates and
// the same transition renders identically every run. Projected through the same far-plane pivot
// `rimPoint`'s scale uses, so the field sits behind the tunnel and the incoming tunnel visibly
// grows out of the region the points fly from.
const starOffset = (i: number): [number, number] => {
  const h1 = Math.sin(i * 12.9898) * 43758.5453;
  const angle = (h1 - Math.floor(h1)) * Math.PI * 2;
  const h2 = Math.sin(i * 78.233 + 1) * 12345.6789;
  const radius = 0.15 + (h2 - Math.floor(h2)) * (STAR_SPREAD - 0.15);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
};
/** Turn the field on: every point starts at its own deterministic depth within the far/near band,
 *  rather than all spawning at the far depth together, so the field already reads as staggered on
 *  its very first frame instead of arriving as one synchronised wave. */
const initStars = (): void => {
  state.starState = 1;
  for (let i = 0; i < STAR_COUNT; i++) {
    const h = Math.sin(i * 39.425) * 23421.631;
    state.starZ[i] = STAR_NEAR + (h - Math.floor(h)) * (STAR_FAR - STAR_NEAR);
  }
};
/** Hard stop — a death during Flight interrupts the whole transition, star field included. */
const stopStars = (): void => {
  state.starState = 0;
  state.starZ.fill(0);
};
/** Each point runs a single pass from wherever it started to STAR_NEAR and then stops — no
 *  recycling. That single-pass guarantee, not a separate drain trigger, is what keeps the field
 *  from ever surviving past the incoming tunnel's resting scale (tuning.ts STAR_START_FRAC). */
const updateStars = (dt: number): void => {
  if (state.starState === 0) return;
  const sec = dt / 1000;
  let any = false;
  for (let i = 0; i < STAR_COUNT; i++) {
    let z = state.starZ[i]!;
    if (z <= 0) continue;
    z -= STAR_RATE * sec;
    if (z <= STAR_NEAR) z = 0;
    state.starZ[i] = z;
    if (z > 0) any = true;
  }
  if (!any) state.starState = 0;
};
const renderStars = (): void => {
  if (state.starState === 0) return;
  const px = CENTER_X + vanX;
  const py = VANISH_Y + vanY;
  for (let i = 0; i < STAR_COUNT; i++) {
    const z = state.starZ[i]!;
    if (z <= 0) continue;
    const s = (NEAR * STAR_FOCAL) / (z + STAR_CAM);
    const [dx, dy] = starOffset(i);
    point(px + dx * s, py + dy * s, COL_STAR, 1.2);
  }
};
// Far-end swarm: a dot per pending enemy, born near the far pivot and easing outward while it
// drifts along the rim, so the wave's pacing is legible before anything actually spawns — driven
// continuously from elapsed time, never from a frame count. `spawn()` is the only place a slot is
// freed, one-for-one with `pending.shift()`, so the pool empties itself exactly when the queue does.
const updateSwarm = (dt: number): void => {
  const sec = dt / 1000;
  const n = laneCount(shape());
  const target = Math.min(SWARM_MAX, state.pending.length);
  let alive = 0;
  for (let i = 0; i < SWARM_MAX; i++) if (state.swarmQ[i]! > 0) alive++;
  for (let i = 0; i < SWARM_MAX; i++) {
    let q = state.swarmQ[i]!;
    if (q > 0) {
      // Distinct (direction, speed) per slot from index arithmetic alone — no stored phase, no
      // hash — is what makes the field read as several independent points milling rather than one
      // rotating ring.
      const rate = 0.6 + (i % 5) * 0.2;
      const dir = i & 1 ? 1 : -1;
      q = Math.min(1, q + SWARM_RATE * rate * sec);
      state.swarmQ[i] = q;
      // Spin is fastest at the pivot and eases to exactly zero as the point settles onto the rim.
      let l = state.swarmL[i]! + dir * SWARM_SPIN * (1 - q) * sec;
      l = ((l % n) + n) % n;
      state.swarmL[i] = l;
    } else if (alive < target) {
      // Birth position: a sine hash of the slot and the current beat, deterministic and unstored —
      // matching `starOffset`'s idiom — and NOT a `rand()` draw, so it cannot shift the wave's own
      // spawn sequence (`updateFlush`'s comment on this: a flush's kill order draws nothing either).
      const h = Math.sin((i + state.beat) * 12.9898) * 43758.5453;
      state.swarmL[i] = (h - Math.floor(h)) * n;
      state.swarmQ[i] = SWARM_Q0;
      alive++;
    }
  }
};
const renderSwarm = (): void => {
  const px = CENTER_X + vanX;
  const py = VANISH_Y + vanY;
  for (let i = 0; i < SWARM_MAX; i++) {
    const q = state.swarmQ[i]!;
    if (q <= 0) continue;
    const p = rimPoint(state.swarmL[i]!, 1);
    point(px + (p[0] - px) * q, py + (p[1] - py) * q, COL_MAGENTA, 0.8 + 0.7 * q);
  }
};
// Death shatter. A killed enemy or ship is replayed through `gfx/lines.ts` `capture` to recover the
// exact screen-space segments it was last drawn from, and each becomes an independent shard flying
// out from the figure's own centre — an affine expansion (velocity is the shard's own offset from
// that centre, no normalise, no divide-by-zero guard: a shard sitting on the centre just spins in
// place) with per-shard speed/spin varied by index alone, the same idiom `updateSwarm` uses for the
// far-end points, and for the same reason: drawing from `rand` here would shift the wave's own
// deterministic spawn sequence.
type Frag = { x: number; y: number; a: number; h: number; vx: number; vy: number; s: number; t: number; c: number };
const frags: Frag[] = [];
/** Runs `draw`, captured, and turns every segment it emitted into a flying, spinning shard. Call
 *  only from `update` — `capture` replays `draw` mid-transform, and `draw()` itself must never run
 *  twice in one frame. */
const burst = (draw: () => void): void => {
  const b = capture(draw);
  const n = b.length / 5;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < b.length; i += 5) {
    cx += (b[i]! + b[i + 2]!) / 2 / n;
    cy += (b[i + 1]! + b[i + 3]!) / 2 / n;
  }
  for (let i = 0; i < b.length; i += 5) {
    const x0 = b[i]!;
    const y0 = b[i + 1]!;
    const dx = b[i + 2]! - x0;
    const dy = b[i + 3]! - y0;
    const mx = x0 + dx / 2;
    const my = y0 + dy / 2;
    const j = i / 5;
    const sp = SHARD_SPEED * (1 + (j % 5) * 0.3);
    frags.push({
      x: mx,
      y: my,
      a: Math.atan2(dy, dx),
      h: Math.hypot(dx, dy) / 2,
      vx: (mx - cx) * sp,
      vy: (my - cy) * sp,
      s: (j & 1 ? 1 : -1) * (SHARD_SPIN + (j % 3) * 3),
      t: SHARD_MS,
      c: b[i + 4]!,
    });
  }
};
const updateFrags = (dt: number): void => {
  const sec = dt / 1000;
  for (let i = frags.length - 1; i >= 0; i--) {
    const f = frags[i]!;
    f.t -= dt;
    if (f.t <= 0) {
      frags.splice(i, 1);
      continue;
    }
    f.x += f.vx * sec;
    f.y += f.vy * sec;
    f.a += f.s * sec;
  }
};
// Fades via the packed colour's alpha byte, not stroke width: `gfx/lines.ts` floors the on-screen
// half-width for visibility, so a width fading to zero would bottom out on that floor and pop
// instead of vanishing — the alpha byte fades all the way to nothing, core, glow and all.
const renderFrags = (): void => {
  for (const f of frags) {
    const k = f.t / SHARD_MS;
    const dx = Math.cos(f.a) * f.h;
    const dy = Math.sin(f.a) * f.h;
    seg(f.x - dx, f.y - dy, f.x + dx, f.y + dy, (f.c & 0xffffff) | ((k * 255) << 24), 1.4);
  }
};
const updateParallax = (dt: number): void => {
  let tx = 0;
  let ty = 0;
  // Only the live playfield leans; Start-Level Select and Game Over draw an arena with no ship, so
  // their target is the centre and any leftover lean eases back out.
  if (state.screen === Screen.Game) {
    const u = state.from + laneDelta(state.from, state.to, shape()) * Math.min(1, state.move);
    // Sampled at z = 0 through the unscaled projection: `rimPointRaw`'s far term — and so this
    // offset — is multiplied by zero at z = 0, giving the player's near-rim offset in logical px
    // with no feedback on itself. Deliberately not `rimPoint`: that function's transition-scale
    // pivot is built from `vanX`/`vanY`, and sampling through it here would feed `vanX` into its
    // own next value through the scale term instead of just the zeroed far term.
    // Negated, so a positive gain moves the far centre opposite the player.
    const q = rimPointRaw(u + 0.5, 0);
    const g = parallax();
    tx = (CENTER_X - q[0]) * g;
    ty = (CENTER_Y - q[1]) * g;
  }
  // Exponential ease on the fixed timestep, so the far end glides across a beat-step instead of
  // snapping to it. Clamped because a long catch-up frame must not overshoot past the target.
  const k = Math.min(1, dt / parallaxMs());
  vanX += (tx - vanX) * k;
  vanY += (ty - vanY) * k;
};
const drawArena = (): void => {
  // A rainbow flush cycles the arena through the whole band palette on its own flat timer
  // (gfx/tune.ts flushFlashMs / FLUSH_FLASH_STEP), deliberately not tied to FLUSH_TICK or the
  // beat: a kill-tick-driven cycle read as a fast, illegible flicker, especially on the
  // single-kill second charge.
  const col =
    state.flushFlash > 0
      ? COL[(((flushFlashMs() - state.flushFlash) / FLUSH_FLASH_STEP) | 0) % COL.length]!
      : COL[(((state.screen === Screen.StartLevelSelect ? state.selected : state.level) - 1) >> 4) % COL.length]!;
  const vertices = 16;
  const near: number[] = [];
  const far: number[] = [];
  for (let i = 0; i < vertices; i++) {
    const a = rimPoint(i, 0);
    const b = rimPoint(i, 1);
    near.push(...a);
    far.push(...b);
    line([...a, ...b], col, WEB_W);
  }
  // An active Pulsar owns one corridor only. Flash exactly its two boundary rails; the map stores
  // owner sets so removing one of two Pulsars cannot extinguish the other one's discharge.
  for (const lane of electricLanes.keys()) {
    line([...rimPoint(lane, 0), ...rimPoint(lane, 1)], COL_GREEN, WEB_W * 1.8);
    line([...rimPoint(lane + 1, 0), ...rimPoint(lane + 1, 1)], COL_GREEN, WEB_W * 1.8);
  }
  line(near, col, WEB_W, !openArena(shape()));
  line(far, col, WEB_W, !openArena(shape()));
};
// Place the beam transform on the tube at lane centre `u`, depth `z`. The p->q rim vector points
// down the tube (near rim to far rim) and `atan2` of it is measured from +x, which is what `xform`
// maps local +x onto. An enemy glyph is authored facing along its own y axis instead, so the
// quarter turn below is added: local +y then points back at the player (a glyph's leading point).
// `look` is how far down the tube the facing is sampled; `spin` is the glyphs' own rotation, which
// folds into the same angle because the beam xform holds only one.
//
// This places a *flat* figure at one projected point — `xform` carries no scale — so a glyph's size
// is faked by hand (`s` below) rather than projected. The ship does not come through here: it is
// projected point by point in `drawShip`, which is the real thing. The glyphs stay on this path
// deliberately, because their hand-fitted 3.4:1 size range is a legibility choice, and the true
// 7:1 projection would halve them at the far rim where their kind still has to be readable.
const tubeXform = (u: number, z: number, look: number, spin = 0): void => {
  const p = rimPoint(u + 0.5, z);
  const q = rimPoint(u + 0.5, Math.min(1, z + look));
  xform(p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]) + Math.PI / 2 + spin);
};
// A spoke's own screen-space direction at `u` — exact at any depth, since `rimPoint` blends the
// near and far endpoints linearly, so the whole spoke is a straight line in screen space between
// them. Used to orient the Flipper's feet flush with their spoke instead of guessing from the
// chord between the two feet, which drifts off the true direction under parallax lean and
// perspective foreshortening.
const spokeDir = (u: number): [number, number] => {
  const [nx, ny] = rimPoint(u, 0);
  const [fx, fy] = rimPoint(u, 1);
  const len = Math.hypot(fx - nx, fy - ny) || 1;
  return [(fx - nx) / len, (fy - ny) / len];
};
// The Flipper (kind 0): an hourglass standing on its current lane, one foot planted on each
// boundary spoke. Traced from reference artwork (`shape-extractor/sandwatch-points.json`,
// normalised then centred on its own bounding box; the two near-duplicate pinch points in the
// trace collapse to one shared vertex). Only the feet follow the tunnel's 3D geometry — the
// shoulders rise in a fixed screen-space direction instead of along the rail, so the figure reads
// as standing upright and always facing the camera rather than lying flat on the tunnel surface.
const drawFlipper = (e: Enemy): void => {
  const h = 0.22;
  let ax: number, ay: number, bx: number, by: number;
  if (e.s === 1) {
    // Mid-flip: the boundary spoke shared by the old and new lane stays fixed all the way
    // through — that is the pivot leg. The other leg swings a half-turn around it, landing on
    // the far boundary of the destination lane, exactly like a gymnast cartwheeling on one foot.
    const d = e.d;
    const pivotU = d > 0 ? e.l - e.t + 1 : e.l + e.t;
    const startU = pivotU - d;
    [ax, ay] = rimPoint(pivotU, e.z);
    const [sx, sy] = rimPoint(startU, e.z);
    const vx = sx - ax;
    const vy = sy - ay;
    const [dax, day] = spokeDir(pivotU);
    // Swing away from the player, toward the vanishing point — like a gate hinging open into the
    // tunnel rather than into the viewer's face — so the gap it leaves is on the near side, where
    // a shot can pass through it or the ship can duck under it.
    const sign = -(Math.sign(vy * dax - vx * day) || 1);
    const a = sign * e.t * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    bx = ax + vx * ca - vy * sa;
    by = ay + vx * sa + vy * ca;
  } else {
    [ax, ay] = rimPoint(e.l, e.z);
    [bx, by] = rimPoint(e.l + 1, e.z);
  }
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  // Scale the billboard height to the actual foot-to-foot pixel distance, so the hourglass sizes
  // itself to the lane it straddles, the way `s` sizes every other glyph. The feet stay pinned to
  // their rails, so the beat-bounce only pulses this height, not a horizontal squash.
  const topH = h * 2 * Math.hypot(bx - ax, by - ay) * bounceY;
  line([bx, by - topH, bx, by, mx, my - topH / 2, ax, ay, ax, ay - topH, mx, my - topH / 2], COL_RED, 1.4, true);
};
/** Fuseball is a star physically riding a rail; only during a jump does it cross a corridor. */
const drawFuseball = (e: Enemy): void => {
  const u = e.mode === 1 || e.mode === 3 ? e.source + shortestRail(e.source, e.target) * e.t : e.l;
  const p = rimPoint(u, e.z);
  const q = rimPoint(u, Math.min(1, e.z + 0.03));
  xform(p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]) + Math.PI / 2);
  const s = 5 + 13 * (1 - e.z);
  const star: number[] = [];
  for (let i = 0; i < 12; i++) {
    const r = i & 1 ? s * 0.38 : s;
    const a = -Math.PI / 2 + (i * Math.PI) / 6;
    star.push(Math.cos(a) * r * bounceX, Math.sin(a) * r * bounceY);
  }
  line(star, COL_MAGENTA, 1.45, true);
  resetXform();
};
/** Pulsar is an electrical wave spanning its corridor, not a generic enemy glyph. */
const drawPulsar = (e: Enemy): void => {
  const warning = e.mode === PulsarPhase.Warning;
  const active = e.mode === PulsarPhase.Active;
  const potency = pulsarParams(state.ordinal).potency / 0xc0;
  const strength = (active ? 1 : warning ? 0.58 : 0.28) * potency;
  const a = rimPoint(e.l, e.z);
  const b = rimPoint(e.l + 1, e.z);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const wave: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const kick = i === 0 || i === 8 ? 0 : (i & 1 ? 1 : -1) * len * 0.14 * strength;
    wave.push(a[0] + dx * t + nx * kick, a[1] + dy * t + ny * kick);
  }
  line(wave, COL_GREEN, active ? 2.1 : 1.35);
  if (active) {
    // Both boundary rails are independent strokes. A single four-point polyline would connect
    // the far end of one rail to the near end of the other and draw a false diagonal.
    line([...rimPoint(e.l, 0), ...a], COL_GREEN, 1.1);
    line([...rimPoint(e.l + 1, 0), ...b], COL_GREEN, 1.1);
  }
};
// Only ever called with kind 1 (Tanker) or 2 (Spiker) — drawEnemy routes 0/3/4 to their own
// dedicated draw functions first.
const drawGlyph = (kind: number, lane: number, z: number, phase: number): void => {
  const s = 5 + 12 * (1 - z);
  const sx = s * bounceX;
  const sy = s * bounceY;
  if (kind === 1) {
    tubeXform(lane, z, 0.02);
    line([-sx, -sy, sx, -sy, sx, sy, -sx, sy, -sx, -sy], COL[2]!, 1.4);
    line([-sx, 0, sx, 0], COL[2]!, 1);
  } else {
    // Traced from the reference pinwheel artwork (`shape-extractor/pinwheel-points.json`,
    // normalised then centred on its own bounding box): twelve vertices, right-angle notches, no
    // interior lines.
    tubeXform(lane, z, 0.02, phase);
    const p = [
      -0.03, -0.86, -0.03, -0.44, 0.42, -0.44, 0.83, -0.03, 0.42, -0.03, 0.42, 0.37, -0.01, 0.78, -0.01, 0.36, -0.44,
      0.36, -0.84, -0.06, -0.45, -0.06, -0.45, -0.45,
    ];
    const spiker: number[] = [];
    for (let i = 0; i < p.length; i += 2) spiker.push(p[i]! * sx, p[i + 1]! * sy);
    line(spiker, COL_CYAN, 1, true);
  }
  resetXform();
};
/** The kind dispatch, shared by `draw`'s enemy loop and the death shatter's capture replay. */
const drawEnemy = (e: Enemy): void => {
  if (e.k === 0) drawFlipper(e);
  else if (e.k === EnemyKind.Fuseball) drawFuseball(e);
  else if (e.k === EnemyKind.Pulsar) drawPulsar(e);
  else drawGlyph(e.k, e.l, e.z, state.music * 4);
};
// The ship is a figure in *lane space*: each authored point (`game/art.ts` SHIP) becomes an offset
// across the lane (`SHIP_U`) and down the tube (`SHIP_Z`, negated so the authored nose at -y lies
// deeper). Flight draws it through `rimPointRaw` — the unscaled projection — so it stays put while
// `tubeScale` carries the old tunnel past it; every other stage draws it through the regular, scaled
// `rimPoint`, the same transform the rest of the near rim uses, so in Entry it is not a separate,
// independently-fixed object floating in front of the new tunnel — it scales up FROM the same point
// the tunnel grows from, as part of it, and lands at rest exactly when the tunnel finishes growing in.
const drawShip = (sx: number, sy: number): void => {
  // Interpolate the signed shortest delta, not `to - from`: `moveLane` wraps `to` into [0, n), so a
  // step across the seam (15 -> 0) would otherwise sweep the ship the long way round the whole tube.
  const d = laneDelta(state.from, state.to, shape());
  const u = state.from + d * Math.min(1, state.move);
  // Mirror the figure to face whichever lane it is currently heading into — `d`'s sign survives
  // arrival (it is only overwritten by the next `startMove`), so the ship keeps facing its last
  // direction of travel rather than snapping back to a default between moves.
  const m = d < 0 ? 1 : -1;
  const proj = state.stage === Stage.Flight ? rimPointRaw : rimPoint;
  const poly: number[] = [];
  for (let i = 0; i < SHIP.length; i += 2)
    poly.push(...proj(u + 0.5 + SHIP[i]! * m * SHIP_U * sx, -SHIP[i + 1]! * SHIP_Z * sy));
  line(poly, COL_PLAYER, 1.7);
};
/** Draw the player's beam between its previous and current positions. */
const drawPlayerShot = (s: Shot, color: string): void => {
  const a = rimPoint(s.l + 0.5, s.pz);
  const b = rimPoint(s.l + 0.5, s.z);
  line([...a, ...b], color, 2);
};
/** White arrowhead whose point follows an enemy shot toward the player at the near rim. */
const drawEnemyShot = (s: Shot): void => {
  const tip = rimPoint(s.l + 0.5, s.z);
  let tail = rimPoint(s.l + 0.5, s.pz);
  let dx = tip[0] - tail[0];
  let dy = tip[1] - tail[1];
  let length = Math.hypot(dx, dy);
  // A just-spawned or debug-frozen shot has no travelled segment yet; sample toward the player.
  if (length < 0.001) {
    tail = rimPoint(s.l + 0.5, Math.max(0, s.z - 0.02));
    dx = tail[0] - tip[0];
    dy = tail[1] - tip[1];
    length = Math.hypot(dx, dy);
  }
  const ux = dx / length;
  const uy = dy / length;
  const size = 2 + (1 - s.z) * 4;
  const baseX = tip[0] - ux * size;
  const baseY = tip[1] - uy * size;
  const wingX = -uy * size * 0.35;
  const wingY = ux * size * 0.35;
  const left = [baseX + wingX, baseY + wingY];
  const right = [baseX - wingX, baseY - wingY];
  line([tip[0], tip[1], ...left], COL_WHITE, 1.6);
  line([tip[0], tip[1], ...right], COL_WHITE, 1.6);
  line([...left, ...right], COL_RED, 1.6);
};
const drawShots = (): void => {
  const playerColor = playerShotColour(state.shots.length);
  for (const s of state.shots) drawPlayerShot(s, playerColor);
  for (const s of state.eshots) drawEnemyShot(s);
};
// A spike's near end can sit close to the far pivot (a repaired or barely-grown one), too close for
// `tubeScale`'s burst to carry off screen the way the near-rim-anchored arena grid does — left alone
// it would still be visibly on screen the instant `enterEntry` resets `state.spikes` for the next
// level, popping instead of receding with the rest of the outgoing tunnel. `shrink` interpolates the
// drawn tip toward the far rim over the same burst window, so it completes its own retreat into the
// vanishing point first, same as the star field. Purely a render transform: `state.spikes` and the
// Flight collision check both keep reading the real, un-shrunk value.
const drawSpikes = (): void => {
  for (let i = 0; i < laneCount(shape()); i++) {
    const z = state.spikes[i]!;
    if (z < 1) line([...rimPoint(i + 0.5, 1), ...rimPoint(i + 0.5, z + (1 - z) * state.burstT)], COL_CYAN, 1.5);
  }
};
const drawRhythm = (): void => {
  const x = W / 2;
  // Centre of the marker's own reserved band, not an offset from the screen edge: the band exists
  // so the chevrons never reach the prompt row below them (layout.ts RHYTHM_H).
  const y = rhythmY;
  // On mobile the bar spans the whole width — a chevron enters at the screen edge and travels to the
  // marker, so the runway is the full half-width less the edge keep-out — and the marker is a fixed
  // fraction of that half-span rather than a constant, which keeps the figure's proportions instead
  // of stranding a small diamond in a wide gap. A desktop viewport keeps the authored quarter-width
  // runway and its 13px marker; the bar there sits under an arena that already fills the screen.
  const half = isMobile ? W / 2 - EDGE_PAD : 13 + Math.min(190, W * 0.25);
  const r = isMobile ? Math.min(half * RHYTHM_MARKER, RHYTHM_H / 2) : 13;
  const age = state.music - Math.max(state.hitFlash, state.missFlash);
  const col = state.missFlash > state.hitFlash && age < 0.15 ? COL_RED : age < 0.12 ? COL_YELLOW : COL_CYAN;
  line([x, y - r, x + r, y, x, y + r, x - r, y, x, y - r], col, r / 7.2);
  for (let i = 0; i < 3; i++) {
    const bt = (Math.floor(state.music / BEAT) + 1 + i) * BEAT;
    const rem = bt - state.music;
    const p = Math.max(0, Math.min(1, 1 - rem / 1.5));
    const d = r + (1 - p) * (half - r);
    line([x - d, y, x - d + r, y - r, x - d, y, x - d + r, y + r], COL_CYAN, r / 13);
    line([x + d, y, x + d - r, y - r, x + d, y, x + d - r, y + r], COL_CYAN, r / 13);
  }
};

// The scene is drawn into an offscreen HDR target and composited through the bloom pipeline by the
// `beginFrame` / `flush` / `endFrame` bracket below, so there is no per-frame background fill any
// more: `beginFrame` clears to black.
const draw = (): void => {
  if (rotateLocked) {
    renderRotate();
    return;
  }

  if (state.screen === Screen.Attract) {
    glowBand(state.t < ATTRACT_LOGO_AT ? HUD_GLOW : 1);
    renderAttract();
    return;
  }
  if (state.screen === Screen.StartLevelSelect) {
    glowBand(GRID_GLOW);
    drawArena();
    glowBand(1);
    renderStartLevelSelect();
    return;
  }
  if (state.screen === Screen.GameOver) {
    glowBand(GRID_GLOW);
    drawArena();
    glowBand(1);
    renderGameOver();
    renderHud();
    return;
  }
  if (state.screen === Screen.Initials) {
    renderInitials();
    renderHud();
    return;
  }

  // Only Screen.Game (every Stage) reaches here — the live playfield: arena, entities, HUD.
  // Beat-bounce: a damped double lobe timed from `state.music` alone (no interpolation/alpha
  // exists in this loop — `render()` takes no arguments — so sampling the clock directly at
  // render time is what keeps this exact to wall-clock beat timing, the same way `drawRhythm`'s
  // own chevron phase already does). Just after the beat, enemies squash top/bottom first
  // (`bounceY < 1`), then side/side (`bounceX < 1`) as `w` crosses zero, then both settle back to
  // 1 and hold there once `decay` bottoms out — one damped cycle per beat. `beatGlow` rides the
  // same decay so the glow brightens exactly while the bounce plays.
  const beatP = (state.music - state.beat * BEAT) / BEAT;
  const beatDecay = Math.max(0, 1 - beatP * 2);
  const beatW = Math.sin(beatP * Math.PI * 4) * beatDecay;
  bounceX = 1 + BOUNCE_AMOUNT * beatW;
  bounceY = 1 - BOUNCE_AMOUNT * beatW;
  const beatGlow = 1 + BOUNCE_GLOW * beatDecay;
  glowBand(GRID_GLOW);
  renderStars();
  drawArena();
  glowBand(beatGlow);
  drawSpikes();
  for (const e of state.enemies) drawEnemy(e);
  renderFrags();
  renderSwarm();
  drawShots();
  if (!(state.screen === Screen.Game && state.stage === Stage.Death)) {
    // Its own, dimmer band: full bloom smears the unicorn figure's fine detail into a blob.
    glowBand(SHIP_GLOW * beatGlow);
    // The ship only bounces when the player actually landed that beat's input (`judgeInput` sets
    // `state.consumed` to the hit beat) — a miss, or no input at all, leaves it at rest, so the
    // bounce reads as a hit reward rather than a metronome the player has no say in.
    const hit = state.consumed === state.beat;
    drawShip(hit ? bounceX : 1, hit ? bounceY : 1);
    glowBand(1);
  }
  drawRhythm();

  // HUD last, and out of the blur entirely — text that bloomed would stop being legible at exactly
  // the moments the playfield is brightest.
  glowBand(HUD_GLOW);
  renderHud();
  renderStageOverlay();
};

// The debug overlay and dat.GUI settings panel are retained in explicit debug builds and
// discarded from release builds. `__DEBUG__` is a Vite literal, so a release build sees
// `if (false)` here — Rolldown drops `dev/gui.ts` and the `dat.gui` devDependency it imports.
let devTick: (() => void) | undefined;
enterConfiguredStart();
if (__DEBUG__) {
  devTick = initDevGui(goToScreen, goToAttractPage, debugWinLevel, debugLoseLife, debugSetLevel, debugAwardLife);
  // Alt+W / Alt+D / Alt+L: the same cheats as the dev panel buttons, without leaving the keyboard.
  addEventListener("keydown", (e) => {
    if (!e.altKey) return;
    if (e.code === "KeyW") {
      e.preventDefault();
      debugWinLevel();
    } else if (e.code === "KeyD") {
      e.preventDefault();
      debugLoseLife();
    } else if (e.code === "KeyL") {
      e.preventDefault();
      debugAwardLife();
    }
  });
}

// One batch per frame: `draw` only appends segments, `flush` uploads and draws them all as sharp
// cores, and `endFrame` replays the same buffer into the glow source before compositing. The
// bracket lives here so every early return inside `draw` is still a complete frame.
const render = (): void => {
  beginFrame();
  draw();
  flush();
  endFrame();
  devTick?.();
};

runLoop(STEP, update, render);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && inPlay()) togglePause();
});
installDebugHook(__DEBUG__, state, startGame, startFlush, () => [vanX, vanY]);
