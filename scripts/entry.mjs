// This project is a single package at its own root, so there is no selection to make —
// `resolveEntry` just reads this directory's own package.json. Kept as its own module so
// `screen-report.mjs` needs no changes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

export function resolveEntry() {
  const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, "utf8"));
  return { name: pkg.name, dir: ROOT };
}
