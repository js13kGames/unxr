// Size gate for the release build. The project opts in by declaring `sizeBudget` in
// package.json (e.g. `{ "bytes": 13312, "zip": "dist/index.zip" }`) and calling
// `node scripts/check-size.mjs` from a build script — `build:release` runs it, since the plain
// `build` is an unminified debug build that is expected to blow the budget.
// No `sizeBudget` field means no gate.
//
// Runs with cwd set to the project root (npm/pnpm run scripts that way), so both the
// package.json read and the default zip path below are resolved relative to `process.cwd()`.
import { readFileSync, statSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const budget = pkg.sizeBudget;

if (!budget) {
  console.log(`\n  no size budget configured for ${pkg.name}; skipping\n`);
  process.exit(0);
}

const { bytes: limit, zip = "dist/index.zip" } = budget;

let size;
try {
  size = statSync(zip).size;
} catch {
  console.error(`\n  ${zip} not found - did \`vite build\` finish?\n`);
  process.exit(1);
}

const percent = ((size / limit) * 100).toFixed(2);
const delta = limit - size;
const verdict = delta >= 0 ? `${delta} bytes left` : `${-delta} bytes OVER BUDGET`;

console.log(`\n  ${zip}  ${size} / ${limit} bytes  ${percent}%  ->  ${verdict}\n`);

if (delta < 0) process.exit(1);
