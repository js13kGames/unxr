# UNxR

A neon rhythm tube shooter for **js13kGames 2026**. WebGL1, TypeScript, no runtime
dependencies — the whole game ships as a single self-contained `index.html` inside a zip, under
the competition's 13,312-byte limit.

## Play

Ride the tunnel edge, line up with enemies, and clear each wave. The gun fires by itself. Left/right
hits on the beat step the ship one lane; a miss skips a shot. Shift/X (or a double tap on touch)
deploys a Rainbow Flush — a timed, twice-per-wave screen clear. Survive sixteen arena shapes and
chase a high score.

## Commands

```sh
pnpm install
pnpm dev              # local dev server, unminified, dev panel
pnpm build             # debug build (unminified, no Roadroller) — for quick local checks
pnpm build:release     # the real js13k build: minified, Roadroller-packed, zipped, size-gated
pnpm preview            # serve the last build
pnpm test               # unit tests (node --experimental-strip-types)
pnpm test:e2e           # Playwright end-to-end suite (spawns its own dev server)
pnpm report:screens      # per-screen byte attribution of the minified bundle
pnpm lint / lint:fix
pnpm format / format:check
```

Copy `.env.example` to `.env` to set `UNXR_START_SCREEN`, which boots `pnpm dev` / `pnpm preview` /
`pnpm test:e2e` straight into a given screen or stage (e.g. `game:play`, `attract:high-score`) —
see `.env.example` for every accepted value.

**Before a competition submission**, run `pnpm build:release` — it fails the process if the zip
exceeds the byte budget, and prints exactly how much room is left.

## Structure

```
src/
  core/      fixed-step loop, viewport
  game/      state, enemy rules, ranking, HUD, the vector-art/model helpers
  gfx/       the WebGL beam renderer, bloom post-process, vector font
  music/     the generated synth
  rhythm/    beat judging
  scenes/    screen/stage enum and the UNXR_START_SCREEN parser
  index.ts   update/render wiring, arena projection, all enemy and ship drawing
scripts/     the size gate and the per-screen byte report
tests/       unit tests (plain Node) and a Playwright end-to-end suite
```

## Credits

- Font: **Player 1 Up**, by Daniel Zadorozny.
- Cover art: Alisiy, [@tangreee](https://twitter.com/tangreee).
- Music: a placeholder tuning fork for this build; the post-compo build carries a track by
  Katie Spogreeva, [@Spogr](https://twitter.com/Spogr).

MIT licensed.
