/**
 * Wave tables and state-independent rules for the two rail enemies. Keeping these values pure
 * lets gameplay use the same source of truth as unit tests, without importing the renderer.
 */
export const EnemyKind = { Flipper: 0, Tanker: 1, Spiker: 2, Fuseball: 3, Pulsar: 4 } as const;

export const PulsarPhase = { Safe: 0, Warning: 1, Active: 2, Recovery: 3, RimChase: 4, RimFlip: 5 } as const;

export const FUSE_CHASE_TUBE = 0x40;
export const FUSE_CHASE_TOP = 0x80;

export interface WaveRange {
  min: number;
  max: number;
}

/** Ordinary Fuseball allocation, including its own intentional gaps between waves. */
export const fuseballRange = (wave: number): WaveRange => {
  if (wave >= 11 && wave <= 16) return { min: 1, max: 1 };
  if (wave >= 22 && wave <= 25) return { min: 1, max: 1 };
  if (wave >= 27 && wave <= 32) return { min: 1, max: 1 };
  if (wave >= 33 && wave <= 39) return { min: 1, max: 4 };
  if (wave >= 40) return { min: 1, max: 3 };
  return { min: 0, max: 0 };
};

/** Ordinary Pulsar allocation. Waves 17–32 carry their own varying upper bound. */
export const pulsarRange = (wave: number): WaveRange => {
  if (wave < 17) return { min: 0, max: 0 };
  if (wave >= 33) return { min: 1, max: 3 };
  const max = [5, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 4, 2][wave - 17]!;
  return { min: 2, max };
};

/** Pulsar's separate phase accumulator rate and visual potency. */
export const pulsarParams = (wave: number): { rate: number; potency: number } => ({
  rate: wave >= 65 ? 8 : wave >= 49 ? 6 : 4,
  potency: wave >= 65 ? 0xc0 : 0xa0,
});

/** Pulsar's rim-chase decision delay, in seconds, from a 60 Hz frame count. */
export const pulsarChaseDelay = (wave: number): number => {
  const frames =
    wave === 17
      ? 40
      : wave === 18
        ? 20
        : wave <= 32
          ? wave & 1
            ? 20
            : 40
          : wave <= 39
            ? 20 - (wave - 33)
            : wave & 1
              ? 20
              : 10;
  return frames / 60;
};

/** Fuseball's rail-change threshold and chase bits. It moves at twice the base invader speed. */
export const fuseballParams = (wave: number): { threshold: number; chase: number; speedScale: number } => {
  const threshold = wave >= 65 ? 230 : wave >= 40 ? 192 + Math.min(24, wave - 40) : wave >= 17 ? 192 : 220;
  const chase = wave >= 49 ? 0xc0 : wave >= 33 ? (wave & 1 ? 0x40 : 0xc0) : wave >= 17 && !(wave & 1) ? 0x40 : 0;
  return { threshold, chase, speedScale: 2 };
};

/** Near-rim kills score more; UNxR depth runs from 1 at far rim down to 0 at the player. */
export const fuseballScore = (depth: number): number => (depth <= 0.25 ? 750 : depth <= 0.58 ? 500 : 250);

export const pulsarCanFire = (wave: number): boolean => wave >= 60;
