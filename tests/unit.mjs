import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SHIP, SHIP_U, SHIP_Z } from "../src/game/art.ts";
import {
  FUSE_CHASE_TOP,
  FUSE_CHASE_TUBE,
  fuseballParams,
  fuseballRange,
  fuseballScore,
  pulsarCanFire,
  pulsarChaseDelay,
  pulsarParams,
  pulsarRange,
} from "../src/game/enemy-rules.ts";
import {
  arenaPoint,
  attractTitleFrame,
  avgScale,
  depthColor,
  depthLayerCount,
  laneCount,
  laneDelta,
  moveLane,
  openArena,
  seeded,
  skillBonus,
  skillLevel,
  START_LEVEL_COUNT,
  START_LEVEL_MAX,
  unlockedKinds,
  wrapLane,
} from "../src/game/model.ts";
import { loadRanks, names, NGAMES_START, NRANKS, rankPlayer, scores } from "../src/game/ranking.ts";
import { judgeBeat } from "../src/rhythm/judge.ts";
import { parseStartTarget, Screen, Stage } from "../src/scenes/modes.ts";
import {
  ATTRACT_LOGO_AT,
  BEAT,
  COL_BLUE,
  COL_RED,
  COL_YELLOW,
  DOUBLE_MS,
  FLUSH_CHARGES,
  FLUSH_TICK,
  playerShotColour,
} from "../src/tuning.ts";

// Rainbow flush cadence: the tick is an eighth of a beat, and the double-tap window stays under
// half a beat so two on-beat taps a player means to land as separate inputs can never collide.
assert.equal(FLUSH_TICK * 8, BEAT, "FLUSH_TICK is an eighth of a beat");
assert.equal(FLUSH_CHARGES, 2, "two rainbow-flush charges per wave");
assert.ok(DOUBLE_MS < BEAT * 500, "the double-tap window is under half a beat, in ms");
assert.equal(playerShotColour(0), COL_YELLOW, "player shots are yellow while capacity is plentiful");
assert.equal(playerShotColour(3), COL_YELLOW, "three of five player shots are still plentiful");
assert.equal(playerShotColour(4), COL_BLUE, "the last available shot changes every player shot to blue");
assert.equal(playerShotColour(5), COL_RED, "a full player-shot pool changes every player shot to red");

assert.deepEqual(parseStartTarget("ATTRACT:LOGO"), { screen: Screen.Attract, sub: 1 });
assert.deepEqual(parseStartTarget("attract:high-score"), { screen: Screen.Attract, sub: 0 });
assert.deepEqual(parseStartTarget("game:play"), { screen: Screen.Game, sub: Stage.Play });
assert.deepEqual(parseStartTarget("start-level-select"), { screen: Screen.StartLevelSelect, sub: -1 });
assert.throws(() => parseStartTarget("nowhere"), /Unknown UNXR_START_SCREEN/);
assert.throws(() => parseStartTarget("demo"), /Unknown UNXR_START_SCREEN/);

const signatures = new Set();
for (let shape = 0; shape < 16; shape++) {
  const points = Array.from({ length: 16 }, (_, i) => arenaPoint(shape, i));
  assert.ok(
    points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    `arena ${shape} is finite`,
  );
  signatures.add(points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(";"));
  assert.equal(laneCount(shape), openArena(shape) ? 15 : 16);

  // Every lane is the same fraction of the rim's perimeter, so adjacent-vertex chords are near
  // equal on every form. The tolerance has to cover genuinely sharp shapes too — a triangle
  // corner, the Sharp Valley's cusp, the Saw Ramp's teeth — where a chord spanning the sharp
  // point is legitimately shorter than the arc it cuts across; before arc-length resampling the
  // spread reached 5.36x.
  const chords = [];
  for (let i = 0; i < laneCount(shape); i++) {
    const a = points[i];
    const b = points[(i + 1) % 16];
    chords.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  const spread = Math.max(...chords) / Math.min(...chords);
  assert.ok(spread < 2.5, `arena ${shape} lane widths are even (spread ${spread.toFixed(2)})`);
}
assert.equal(signatures.size, 16, "all arena formulas are distinct");

assert.deepEqual(fuseballRange(10), { min: 0, max: 0 }, "Fuseballs do not spawn before wave 11");
assert.deepEqual(fuseballRange(11), { min: 1, max: 1 }, "wave 11 has one ordinary Fuseball");
assert.deepEqual(fuseballRange(17), { min: 0, max: 0 }, "Fuseball's 17–21 gap is preserved");
assert.deepEqual(fuseballRange(33), { min: 1, max: 4 }, "late Fuseball range expands at wave 33");
assert.equal(fuseballParams(17).chase, 0, "wave 17 Fuseball has no forced chase");
assert.equal(fuseballParams(18).chase, FUSE_CHASE_TUBE, "wave 18 enables tube chase only");
assert.equal(fuseballParams(34).chase, FUSE_CHASE_TUBE | FUSE_CHASE_TOP, "wave 34 enables top chase");
assert.equal(fuseballParams(49).speedScale, 2, "Fuseball rides rails at double base speed");
assert.deepEqual(
  [fuseballScore(0.8), fuseballScore(0.4), fuseballScore(0.1)],
  [250, 500, 750],
  "Fuseball score rises near the rim",
);

assert.deepEqual(pulsarRange(16), { min: 0, max: 0 }, "Pulsars do not spawn before wave 17");
assert.equal(pulsarRange(17).min, 2, "early Pulsar waves reserve two ordinary Pulsars");
assert.deepEqual(pulsarRange(33), { min: 1, max: 3 }, "late Pulsar allocation uses its own range");
assert.deepEqual(
  [pulsarParams(48).rate, pulsarParams(49).rate, pulsarParams(65).rate],
  [4, 6, 8],
  "Pulsar pulse rate follows wave thresholds",
);
assert.ok(pulsarChaseDelay(18) < pulsarChaseDelay(17), "Pulsar rim chase accelerates after wave 17");
assert.ok(pulsarChaseDelay(40) < pulsarChaseDelay(39), "late Pulsar chase gets a shorter decision delay");
assert.equal(pulsarCanFire(59), false, "Pulsars cannot fire before wave 60");
assert.equal(pulsarCanFire(60), true, "Pulsars fire from wave 60");

assert.deepEqual(
  Array.from({ length: 16 }, (_, shape) => shape).filter(openArena),
  [8, 9, 10, 13, 14],
  "the five revised open arenas have no wraparound seam",
);

const doubleDome = Array.from({ length: 16 }, (_, i) => arenaPoint(14, i));
assert.ok(Math.abs(doubleDome[0].y) < 1e-7, "Level 15's left endpoint lies on the baseline");
assert.ok(Math.abs(doubleDome[15].y) < 1e-7, "Level 15's right endpoint lies on the baseline");
assert.ok(doubleDome[4].y > doubleDome[7].y, "Level 15's left upper lobe rises above its central dimple");
assert.ok(doubleDome[11].y > doubleDome[8].y, "Level 15's right upper lobe rises above its central dimple");

// Level 1's arena is a plain circle with sixteen lane points starting at the top.
for (let i = 0; i < 16; i++) {
  const a = -Math.PI / 2 + (i * Math.PI) / 8;
  const p = arenaPoint(0, i);
  assert.ok(
    Math.abs(p.x - Math.cos(a)) < 1e-6 && Math.abs(p.y - Math.sin(a)) < 1e-6,
    `level 1 vertex ${i} sits on the circle`,
  );
}

assert.equal(moveLane(0, -1, 8), 0, "open left edge clamps");
assert.equal(moveLane(14, 1, 8), 14, "open right edge clamps");
assert.equal(moveLane(0, -1, 0), 15, "closed edge wraps");

// laneDelta: the ship travels the short way, so a seam crossing is one lane, not fifteen.
assert.equal(laneDelta(15, 0, 0), 1, "closed seam forward is +1");
assert.equal(laneDelta(0, 15, 0), -1, "closed seam backward is -1");
assert.equal(laneDelta(3, 4, 0), 1, "closed step forward");
assert.equal(laneDelta(4, 3, 0), -1, "closed step backward");
assert.equal(laneDelta(5, 5, 0), 0, "no move is zero");
assert.equal(laneDelta(14, 14, 8), 0, "open clamped edge is zero");
for (let shape = 0; shape < 16; shape++)
  for (let lane = 0; lane < laneCount(shape); lane++)
    for (const dir of [-1, 1]) {
      const to = moveLane(lane, dir, shape);
      const step = Math.abs(laneDelta(lane, to, shape));
      assert.ok(step <= 1, `arena ${shape} lane ${lane} dir ${dir}: one-lane step, not ${step}`);
    }
// wrapLane keeps a rim-chasing enemy's lane on the arena: positive modulo on a closed form, clamp
// on an open one. A Flipper that walks past the seam must fold back to a real lane, not run away.
assert.equal(wrapLane(16, 0), 0, "closed: one past the seam folds to 0");
assert.equal(wrapLane(-1, 0), 15, "closed: one before 0 folds to 15");
assert.equal(wrapLane(33.5, 0), 1.5, "closed: keeps the fractional part");
assert.equal(wrapLane(-16.25, 0), 15.75, "closed: negative fractional folds in");
assert.equal(wrapLane(20, 8), 14, "open: clamps to the last lane");
assert.equal(wrapLane(-3, 8), 0, "open: clamps to the first lane");
assert.equal(wrapLane(7, 8), 7, "open: an in-range lane is unchanged");
for (let shape = 0; shape < 16; shape++)
  for (let l = -40; l <= 40; l += 0.25) {
    const w = wrapLane(l, shape);
    assert.ok(w >= 0 && w < laneCount(shape), `arena ${shape}: wrapLane(${l}) = ${w} is on the arena`);
  }

// The ship's figure is authored as a point set and projected into lane/depth space by `drawShip`.
// These are the invariants that mechanism relies on, so swapping the figure cannot break it silently.
assert.equal(SHIP.length % 2, 0, "ship figure is a flat list of x,y pairs");
assert.ok(SHIP.length >= 8, "ship figure has at least four points");
assert.deepEqual(SHIP.slice(0, 2), SHIP.slice(-2), "ship figure is closed by repeating its first point");
const shipX = SHIP.filter((_, i) => i % 2 === 0);
const shipY = SHIP.filter((_, i) => i % 2 === 1);
// Every point stays inside its own lane, which is what keeps `rimPoint`'s open-arena clamp (u to
// [0, 15]) out of reach on the end lanes, where a lane centre sits at 0.5 or 14.5.
assert.ok(Math.max(...shipX.map(Math.abs)) * SHIP_U < 0.5, "ship figure stays within one lane");
// The nose is at -y and `drawShip` negates y, so the figure must have a point ahead of its anchor.
assert.ok(Math.min(...shipY) < 0, "ship figure has a nose at negative y");
// At the end of the fly-out the deepest point sits past the far rim on purpose; `rimPoint`'s depth
// curve only misbehaves beyond z ~= 1.52, so the overshoot has to stay well inside that.
assert.ok(1 + Math.max(...shipY.map((y) => -y)) * SHIP_Z < 1.4, "deepest ship point stays in the safe depth range");

assert.equal(judgeBeat(0.109, -1).hit, true, "early window edge hits");
assert.equal(judgeBeat(0.111, -1).hit, false, "outside window misses");
assert.equal(judgeBeat(0.01, 0).hit, false, "consumed beat cannot repeat");
assert.deepEqual([1, 2, 3, 10, 11, 16, 17].map(unlockedKinds), [1, 1, 2, 3, 4, 4, 5]);
const a = seeded(99);
const b = seeded(99);
assert.deepEqual([a(), a(), a()], [b(), b(), b()], "wave PRNG is reproducible");

// Attract holds High Score for 20 s, then Logo indefinitely — Logo has no timer of its own.
assert.equal(ATTRACT_LOGO_AT, 20000, "High Score holds 20 s before Logo");

// The box renders its current counters before each 20 Hz update: exactly twenty visible states,
// peaking at 51 layers on frame 8, then the logo starts from the same depth interval.
const boxStates = [
  [24, 25],
  [24, 45],
  [24, 65],
  [32, 85],
  [40, 105],
  [48, 125],
  [56, 145],
  [64, 165],
  [72, 165],
  [80, 165],
  [88, 165],
  [96, 165],
  [104, 165],
  [112, 165],
  [120, 165],
  [128, 165],
  [136, 165],
  [144, 165],
  [152, 165],
  [160, 165],
];
assert.deepEqual(
  boxStates.map((_, tick) => {
    const frame = attractTitleFrame(tick * 50);
    return [frame.front, frame.back];
  }),
  boxStates,
);
const inheritedTitleColor = ({ front, back }) => {
  const last = back <= front ? front : front + 2 * Math.floor((back - 1 - front) / 2);
  return depthColor(last, front);
};
assert.deepEqual(
  boxStates.map((_, tick) => inheritedTitleColor(attractTitleFrame(tick * 50))),
  [0, 5, 0, 2, 5, 3, 2, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  "copyright inherits the BOX stack's last layer color",
);
assert.equal(inheritedTitleColor({ front: 104, back: 165 }), 4, "late BOX copyright is cyan");
assert.equal(inheritedTitleColor({ front: 47, back: 81 }), 1, "expanded logo copyright is yellow");
assert.equal(inheritedTitleColor({ front: 47, back: 47 }), 0, "final logo copyright is white");
assert.equal(depthLayerCount(64, 165), 51, "box frame 8 is the maximum stack");
assert.deepEqual(attractTitleFrame(999), { box: true, front: 160, back: 165 });
assert.deepEqual(attractTitleFrame(1000), { box: false, front: 160, back: 165 });
assert.deepEqual(attractTitleFrame(1000 + 32 * 50), { box: false, front: 128, back: 165 });
assert.deepEqual(attractTitleFrame(1000 + 113 * 50), { box: false, front: 47, back: 84 });
assert.deepEqual(attractTitleFrame(1000 + 150 * 50), { box: false, front: 47, back: 47 });
assert.equal(depthLayerCount(47, 47), 1, "do-first depth rendering retains the final logo");
// The PRESS START prompt keys off front === back — the zoom's settle point, reached at 8.5 s.
assert.deepEqual(attractTitleFrame(8500), { box: false, front: 47, back: 47 }, "logo settles at 8.5s");
assert.equal(avgScale(24), 1.2421875);
assert.equal(avgScale(47), 0.76171875);
assert.equal(avgScale(104), 0.2177734375);
assert.deepEqual(
  [24, 25, 56, 64].map((depth) => depthColor(depth, 24)),
  [0, 3, 3, 0],
);

// Reproduce the title sequence with a parallel iterative simulation and compare it against the
// closed forms throughout the full sequence, including repeated renders inside each tick, skips,
// collapse, and the final hold.
const titleReference = { box: true, front: 24, back: 25 };
for (let tick = 0; tick < 223; tick++) {
  for (const offset of [0, 16.6666667, 33.3333333, 49.999])
    assert.deepEqual(attractTitleFrame(tick * 50 + offset), titleReference, `title tick ${tick}, offset ${offset}`);
  if (titleReference.box) {
    if (titleReference.back < 160) titleReference.back += 20;
    if (titleReference.back >= 80) {
      titleReference.front += 8;
      if (titleReference.front >= titleReference.back) {
        titleReference.front = 160;
        titleReference.box = false;
      }
    }
  } else {
    if (titleReference.front >= 48) titleReference.front--;
    if (titleReference.front < 128) titleReference.back = Math.max(titleReference.front, titleReference.back - 1);
  }
}
assert.deepEqual(attractTitleFrame(0), { box: true, front: 24, back: 25 }, "reentry restarts the box");

// All 28 irregular Skill-Step checkpoints are generated by index, without a production lookup table.
assert.equal(START_LEVEL_COUNT, 28);
assert.equal(START_LEVEL_MAX, 81);
assert.deepEqual(
  Array.from({ length: START_LEVEL_COUNT }, (_, index) => skillLevel(index)),
  [1, 3, 5, 7, 9, 11, 13, 15, 17, 20, 22, 24, 26, 28, 31, 33, 36, 40, 44, 47, 49, 52, 56, 60, 63, 65, 73, 81],
);

// Formula-based score progression is monotonic and keeps the reference's level 1/9 anchors.
assert.equal(skillBonus(1), 0);
assert.equal(skillBonus(9), 54000);
for (let index = 1; index < START_LEVEL_COUNT; index++)
  assert.ok(skillBonus(skillLevel(index)) > skillBonus(skillLevel(index - 1)));

const drawSources = await Promise.all(
  ["../src/index.ts", "../src/game/hud.ts"].map((p) => readFile(new URL(p, import.meta.url), "utf8")),
);
for (const source of drawSources)
  assert.doesNotMatch(source, /(?:fillText|strokeText|\.font\s*=)/, "all text uses the vector font");

assert.equal(NGAMES_START, 8, "ranking population starts seeded with the eight filler High Scores");
assert.equal(Math.min(NRANKS, NGAMES_START + 1), 9, "one game started grows the population by 1");
assert.equal(Math.min(NRANKS, 99 + 1), 99, "the population never exceeds NRANKS");

// First place: a new best displaces the old #1 and its initials down one slot.
loadRanks([50000, 40000, 30000], ["AAA", "BBB", "CCC"]);
assert.equal(rankPlayer(60000), 1, "a new best score ranks 1");
assert.deepEqual(scores.slice(0, 4), [60000, 50000, 40000, 30000]);
assert.deepEqual(names.slice(0, 4), ["  A", "AAA", "BBB", "CCC"], "displaced initials move with their score");

// Ninth place: eight higher scores and an empty rest of the table rank the player 9th.
loadRanks([], []);
assert.equal(rankPlayer(260), 9, "260 points against a fresh, all-default table ranks 9th");
assert.deepEqual(names, ["AAA", "AAA", "AAA", "AAA", "AAA", "AAA", "AAA", "AAA"], "rank 9 requests no initials");

// Equal scores: strict `>` insertion means a tie never displaces the existing entry.
loadRanks([50000, 40000, 30000], ["AAA", "BBB", "CCC"]);
assert.equal(rankPlayer(40000), 3, "an exact tie ranks behind the existing equal entry, not ahead of it");
assert.deepEqual(scores.slice(0, 4), [50000, 40000, 40000, 30000]);
assert.deepEqual(names.slice(0, 4), ["AAA", "BBB", "  A", "CCC"], "the older equal entry keeps its slot");

// Reduced precision below rank 58: two scores sharing the top four digits rank equal there even
// though their last two digits differ.
loadRanks([], []);
for (let i = 0; i < 57; i++) rankPlayer(999999 - i); // fill ranks 1..57, all above the boundary
assert.equal(rankPlayer(500055), 58, "the first entry past the boundary ranks by its trimmed score");
assert.equal(
  rankPlayer(500001),
  59,
  "500001 and 500055 share their top four digits, so the tie ranks the second insert right behind",
);
assert.deepEqual(scores.slice(57, 59), [500000, 500000], "both are stored with their last two digits zeroed");

// A score beating nothing ranks 98, not 99, and the population is left untouched.
loadRanks([], []);
for (let i = 0; i < 97; i++) rankPlayer(1000000 - i); // saturate every rank above the last one
assert.equal(scores.length, 98);
const before = scores.slice();
assert.equal(rankPlayer(1), 98, "a score lower than everything still ranks 98, not 99");
assert.deepEqual(scores, before, "and nothing in the table is displaced");

console.log("UNxR unit tests: PASS");
