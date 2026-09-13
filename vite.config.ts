import { js13kViteConfig } from "js13k-vite-plugins";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, mergeConfig, type UserConfig } from "vite";
import { parseStartTarget } from "./src/scenes/modes.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const startTarget = parseStartTarget(process.env.UNXR_START_SCREEN ?? env.UNXR_START_SCREEN ?? "attract:logo");

  return mergeConfig(
    js13kViteConfig({ imageMinOptions: false, roadrollerOptions: mode === "debug" ? false : undefined }) as UserConfig,
    {
      base: "./",
      resolve: {
        alias:
          mode === "release"
            ? // `if (__DEBUG__)` alone does not keep `dat.gui` out of a release build — a static
              // import's whole dependency graph gets bundled once the binding is referenced
              // anywhere, dead branch or not (see `dev/gui.none.ts`). Swapping the specifier
              // itself is the reliable way to keep it out.
              { "./dev/gui": fileURLToPath(new URL("./src/dev/gui.none.ts", import.meta.url)) }
            : {},
      },
      define: {
        __DEBUG__: JSON.stringify(mode !== "release"),
        __BUILD__: JSON.stringify(process.env.BUILD_NUMBER ?? "dev"),
        __START_TARGET__: JSON.stringify(startTarget),
      },
      build: {
        outDir: "dist",
        emptyOutDir: true,
        modulePreload: false,
        ...(mode === "debug" ? { minify: false } : {}),
      },
    },
  );
});
