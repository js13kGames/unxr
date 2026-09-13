/**
 * The player ship's figure, as a flat list of points `[x0, y0, x1, y1, ...]` in authored px,
 * centred on the origin, **nose at negative y**. Written closed — the last point repeats the first
 * — so no call site needs `line`'s `close` flag.
 *
 * A running unicorn, horn forward: traced from reference artwork
 * (`shape-extractor/unicorn-side-points.json`, centred on its own bounding box, then rotated so the
 * horn — off to one side in the raw side-on trace — swings to point straight off the origin instead
 * of at an angle, landing it on the lane's own centreline instead of left or right of it). The horn
 * tip is the figure's first point, i.e. its nose — `SHIP_NOSE_Z` below is exactly that point's
 * projected depth, so a fired shot can be born from the same spot the horn is drawn at. `drawShip`
 * mirrors the whole figure left/right to face whichever lane the ship is currently moving into.
 *
 * Two consumers, one figure:
 *   - `index.ts` `drawShip` maps each point into lane/depth space and projects it through
 *     `rimPoint`, so the figure picks up the rim curve, the depth taper and the far-centre parallax
 *     of the lane it sits on — the same projection the spokes, shots and spikes use.
 *   - `game/hud.ts` `drawShipIcon` draws it flat and unrotated for the HUD life icons.
 *
 * Two invariants the tube path depends on, both asserted in `tests/unit.mjs`:
 *   - closed by repetition, and an even number of coordinates;
 *   - `max|x| * SHIP_U < 0.5`, which keeps every point inside its own lane and so keeps
 *     `rimPoint`'s open-arena clamp unreachable on the end lanes.
 */
export const SHIP: number[] = [
  0, -17, 0.7, -12.5, 1, -12.4, 2.9, -6, 1.8, -6, 1.6, -3, -1.7, -2.3, 2.6, 1.3, 6.7, 2.2, 8.3, 2.7, 7, 9.7, 6.2, 13.1,
  6, 13.2, 2.5, 1.8, 0.3, 9.2, -1.8, 15.1, -2, 15.2, -3.3, 3.1, -7.5, -0.4, -9.3, -5.1, -10.9, -1.7, -11, -1.7, -11,
  -2.1, -10.3, -8.4, -6.5, -6.5, -1.5, -9.5, -6.3, -11.5, -5.2, -12.1, -1.2, -12.4, -0.1, -16.9, 0, -17,
];

/** Authored px -> lane units across the rim. At the tube mouth one authored px is ~2.3 logical px. */
export const SHIP_U = 0.04;
/** Authored px -> depth units down the tube. Negated at the draw site, so the authored nose at -y
 *  lies deeper. Deliberately below the isotropic value: a figure lying along the tube is seen at a
 *  grazing angle and should read foreshortened. */
export const SHIP_Z = 0.006;
/** The horn tip's own depth offset (`SHIP`'s first point negated and scaled, matching `drawShip`'s
 *  projection) — where a fired shot has to originate for it to visibly leave the horn. */
export const SHIP_NOSE_Z = -SHIP[1]! * SHIP_Z;
