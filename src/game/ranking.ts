// A 98-position ranking population, of which the top 8 are the visible high-score table. A plain
// array with a linear insertion scan — no packed lookup structure — gets the whole rule set for
// little code: a population counter, strict-greater insertion, reduced precision below rank 58,
// initials riding along with their score, and a beaten-by-everyone score landing at 98, not 99.
//
// Two-player ranking is not implemented — UNxR has no two-player mode.
//
// No local imports on purpose — like `game/model.ts`, this stays a pure, dependency-free module so
// `tests/unit.mjs` can import it directly under plain node.

/** Ranking population counter (`NGAMES`): seeded with the eight filler High Scores, +1 per game
 *  started, saturating at `NRANKS`. */
export const NGAMES_START = 8;
export const NRANKS = 99;

/** Best score first; 98 entries total. Slots 0..7 are the visible HIGH SCORES table. */
export const scores: number[] = [];
/** Initials for the visible top 8, index-aligned with `scores`. */
export const names: string[] = [];

/** Below rank 58, only the top four digits are compared — precision drops the deeper the position. */
const trim = (score: number, rank: number): number => (rank > 56 ? score - (score % 100) : score);

/** The visible eight default to 10101 with the given initials; every lower ranking position starts
 *  empty, which is what makes an ordinary score rank 9 rather than 98. */
export const loadRanks = (topScores: number[], initials: string[]): void => {
  scores.length = 0;
  names.length = 0;
  for (let i = 0; i < 8; i++) {
    scores.push(topScores[i] ?? 10101);
    names.push(initials[i] ?? "AAA");
  }
  while (scores.length < 98) scores.push(0);
};

/** Inserts `score` into the ranking population and returns its 1-based rank; a score that beats
 *  nothing returns 98, the last position — not 99. Strict `>` insertion means an exact tie keeps
 *  the older entry ahead. */
export const rankPlayer = (score: number): number => {
  let i = 0;
  while (i < 98 && trim(score, i) <= scores[i]!) i++;
  if (i < 98) {
    scores.splice(i, 0, trim(score, i));
    scores.length = 98;
    if (i < 8) {
      names.splice(i, 0, "  A"); // placeholder shown while Initials is being entered
      names.length = 8;
    }
  }
  return Math.min(i + 1, 98);
};
