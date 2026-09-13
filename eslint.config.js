import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "temp/"],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { "@stylistic": stylistic },
    rules: {
      "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
      "@stylistic/semi": ["error", "always"],
      "@stylistic/linebreak-style": ["error", "unix"],
      eqeqeq: ["error", "always"],
      "no-console": "warn",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-explicit-any": ["error", { ignoreRestArgs: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration[const=true]",
          message: "Use an `as const` object instead: `const enum` is not inlined by Rolldown/oxc.",
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off", "@typescript-eslint/explicit-module-boundary-types": "off" },
  },
  {
    // Playwright verification suite — a Node script whose page.evaluate callbacks run in the browser.
    files: ["tests/**/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },
);
