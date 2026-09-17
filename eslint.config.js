import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "src/api/schema.d.ts", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  prettier,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // tsc already enforces noUnusedLocals; allow `_`-prefixed intentional ignores.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // Non-null assertions are used deliberately after length/index checks throughout.
      "@typescript-eslint/no-non-null-assertion": "off",
      // Screens export a component plus small helpers/hooks; HMR granularity is not worth the churn.
      "react-refresh/only-export-components": "off",
      // React Compiler readiness rules — the app doesn't use the compiler; keep the classic two.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
);
