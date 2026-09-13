export interface Judgement {
  beat: number;
  hit: boolean;
}

export const judgeBeat = (time: number, lastConsumed: number, window = 0.11, period = 0.5): Judgement => {
  const beat = Math.round(time / period);
  return { beat, hit: beat !== lastConsumed && Math.abs(time - beat * period) <= window };
};
