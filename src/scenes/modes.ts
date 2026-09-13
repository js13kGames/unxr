/** Top-level screens. Game is entered only from StartLevelSelect and left only from the Death stage at
 *  zero lives — every other transition stays inside Game as a Stage change (see `Stage`). */
export const Screen = {
  Attract: 0,
  StartLevelSelect: 1,
  Game: 2,
  GameOver: 3,
  Initials: 4,
} as const;

export type Screen = (typeof Screen)[keyof typeof Screen];

/** Stages internal to `Screen.Game`. Pause interrupts Play or Flight and returns to whichever
 *  one it interrupted — it has no meaning outside Game, so it is not a top-level Screen. */
export const Stage = {
  Entry: 0,
  Play: 1,
  Death: 2,
  Flight: 3,
  Pause: 4,
} as const;

export type Stage = (typeof Stage)[keyof typeof Stage];

export interface StartTarget {
  screen: Screen;
  sub: number;
}

const START_TARGETS: Record<string, StartTarget> = {
  attract: { screen: Screen.Attract, sub: 1 },
  "attract:logo": { screen: Screen.Attract, sub: 1 },
  "attract:high-score": { screen: Screen.Attract, sub: 0 },
  "start-level-select": { screen: Screen.StartLevelSelect, sub: -1 },
  game: { screen: Screen.Game, sub: Stage.Entry },
  "game:entry": { screen: Screen.Game, sub: Stage.Entry },
  "game:play": { screen: Screen.Game, sub: Stage.Play },
  "game:death": { screen: Screen.Game, sub: Stage.Death },
  "game:flight": { screen: Screen.Game, sub: Stage.Flight },
  "game:pause": { screen: Screen.Game, sub: Stage.Pause },
  "game-over": { screen: Screen.GameOver, sub: -1 },
  initials: { screen: Screen.Initials, sub: -1 },
};

export const parseStartTarget = (value: string): StartTarget => {
  const name = value.trim().toLowerCase();
  const target = START_TARGETS[name];
  if (!target) throw new Error(`Unknown UNXR_START_SCREEN: "${value}"`);
  return target;
};
