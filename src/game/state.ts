// The mutable state singleton and its persisted counterpart. Deliberately separate from both
// `index.ts` (the update/render loop) and `game/hud.ts` (screen drawing), so neither of those two
// ever has to import the other.
import { min, random } from "../core/system";
import { Screen, Stage, type Screen as ScreenType, type Stage as StageType } from "../scenes/modes";
import { ATTRACT_LOGO_AT, FLUSH_CHARGES, STAR_COUNT, START_LIVES, SWARM_MAX } from "../tuning";
import { loadRanks, NGAMES_START, NRANKS, names as rankNames, scores as rankScores } from "./ranking";

export const INI_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const randomInitials = (): string => {
  let value = "";
  for (let i = 0; i < 3; i++) value += INI_CHARS[(random() * INI_CHARS.length) | 0]!;
  return value;
};

const createRankNames = (): string[] => {
  const names = [randomInitials(), "SAM", randomInitials(), "BOB", "BOT"];
  while (names.length < 8) names.push(randomInitials());
  return names;
};

export interface Enemy {
  /** Stable identity: Pulsar uses it to own an electrified lane. */
  id: number;
  k: number;
  l: number;
  z: number;
  pz: number;
  s: number;
  t: number;
  d: number;
  fire: number;
  /** Enemy-specific state: Fuseball ride/jump or Pulsar pulse/rim phase. */
  mode: number;
  /** Continuous pulse or jump clock, kept separate from the legacy flip interpolation `t`. */
  phase: number;
  /** Rail/lane at which the current leap began and where it will land. */
  source: number;
  target: number;
  /** True while this Pulsar owns an active lane-electricity source. */
  electric: boolean;
  /** Tanker payload; ignored by every non-Tanker enemy. */
  cargo: number;
}

export interface Shot {
  l: number;
  z: number;
  pz: number;
}

export interface State {
  screen: ScreenType;
  /** Only meaningful while `screen === Screen.Game`. */
  stage: StageType;
  /** The stage Pause interrupted — always Play or Flight. */
  beforePause: StageType;
  t: number;
  music: number;
  beat: number;
  consumed: number;
  hitFlash: number;
  missFlash: number;
  score: number;
  lives: number;
  ordinal: number;
  level: number;
  /** Level selected for this run; used to award its Skill-Step bonus exactly once on completion. */
  startLevel: number;
  selectedIndex: number;
  selected: number;
  /** Ms left in Start-Level Select's confirm flash; 0 when the player hasn't confirmed yet. Counts
   *  down to 0, at which point the chosen level actually starts (`index.ts`
   *  updateStartLevelSelect). */
  selFlash: number;
  lane: number;
  from: number;
  to: number;
  move: number;
  fire: number;
  hold: number;
  /** Rainbow-flush charges left this wave (0..FLUSH_CHARGES). */
  flush: number;
  /** Seconds left in the running deployment; 0 when none runs. It also gates spawning, since a
   *  deployment and a spawn pause are the same event. */
  flushT: number;
  /** Kills this deployment still owes. Snapshotted at the press, so a deployment cannot grow. */
  flushLeft: number;
  /** Ms left on the rainbow announcement — a flat real-time timer, independent of `flushT`/
   *  `flushLeft` (see `FLUSH_FLASH_MS`). */
  flushFlash: number;
  /** Ms left on the centred extra-life announcement. */
  lifeFlash: number;
  protect: number;
  pending: number[];
  enemies: Enemy[];
  shots: Shot[];
  eshots: Shot[];
  spikes: Float32Array;
  flight: number;
  /** `flight`'s own rate of advance, in 1/s. Grows through Flight so the descent accelerates
   *  instead of moving at a flat rate. */
  flightSpeed: number;
  flightDeath: boolean;
  /** `burstMs / FLIGHT_BURST_MS`, `0` outside Flight's burst phase — mirrored onto `state` (the
   *  pacing timer itself, `burstMs`, is a module-private `index.ts` render variable) purely so
   *  `game/hud.ts` can read the same progress `drawSpikes`'s own shrink uses, with no import cycle. */
  burstT: number;
  /** Per-point depth. `0` = not currently flying — either never spawned or, while draining,
   *  cleared for good. */
  starZ: Float32Array;
  /** `0` off, `1` running. Each point runs a single pass to the near limit and stops — no
   *  recycling — so the field turns itself off once every point has finished. */
  starState: number;
  /** Far-end swarm — a dot per pending enemy, milling near the vanishing point before it settles
   *  onto the far rim (`index.ts` updateSwarm/renderSwarm). `0` = free slot; otherwise the point's
   *  emergence, `SWARM_Q0..1`, which doubles as its render lerp toward the rim so there is no
   *  separate alive flag. */
  swarmQ: Float32Array;
  /** Per-slot fractional lane, drifting toward its settle position as `swarmQ` climbs. */
  swarmL: Float32Array;
  iniIndex: number;
  iniChars: number[];
  /** The rank the last completed run earned; 0 before any run has been ranked. */
  rank: number;
}

export const state: State = {
  screen: Screen.Attract,
  stage: Stage.Play,
  beforePause: Stage.Play,
  // The first session opens directly on Attract's Logo page. Later entries use `enterAttract`.
  t: ATTRACT_LOGO_AT,
  music: 0,
  beat: -1,
  consumed: -99,
  hitFlash: -9,
  missFlash: -9,
  score: 0,
  lives: START_LIVES,
  ordinal: 1,
  level: 1,
  startLevel: 1,
  selectedIndex: 0,
  selected: 1,
  selFlash: 0,
  lane: 0,
  from: 0,
  to: 0,
  move: 1,
  fire: 0,
  hold: 0,
  flush: FLUSH_CHARGES,
  flushT: 0,
  flushLeft: 0,
  flushFlash: 0,
  lifeFlash: 0,
  protect: 0,
  pending: [],
  enemies: [],
  shots: [],
  eshots: [],
  spikes: new Float32Array(16).fill(1),
  flight: 0,
  flightSpeed: 0,
  flightDeath: false,
  burstT: 0,
  starZ: new Float32Array(STAR_COUNT),
  starState: 0,
  swarmQ: new Float32Array(SWARM_MAX),
  swarmL: new Float32Array(SWARM_MAX),
  iniIndex: 0,
  iniChars: [0, 0, 0],
  rank: 0,
};

export interface Saved {
  vol: number;
  /** Ranking population size — see `ranking.ts` (`NGAMES`). */
  ngames: number;
}

let needsSave = false;
export const saved: Saved = (() => {
  try {
    const v = JSON.parse(localStorage.getItem("unxr1") || "{}");
    const rankNamesStored = v["r"] as string[] | undefined;
    needsSave = !rankNamesStored;
    loadRanks((v["s"] as number[] | undefined) ?? [], rankNamesStored ?? createRankNames());
    return {
      vol: +v["v"] || 0.22,
      ngames: min(NRANKS, +v["g"] || NGAMES_START),
    };
  } catch {
    needsSave = true;
    loadRanks([], createRankNames());
    return { vol: 0.22, ngames: NGAMES_START };
  }
})();

export const save = (): void => {
  try {
    localStorage.setItem(
      "unxr1",
      JSON.stringify({
        ["v"]: saved.vol,
        ["g"]: saved.ngames,
        ["r"]: rankNames,
        ["s"]: rankScores.slice(0, 3),
      }),
    );
  } catch {
    /* storage is optional */
  }
};

if (needsSave) save();
