import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Correctness only: no stylistic or formatting rules, so enabling this does not rewrite existing
// files. Formatting is a separate concern and intentionally not enforced here.
export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.data/**", "**/*.d.ts"] },
  {
    files: ["backend/**/*.ts", "frontend/src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Compiler-only rule. It flags ordinary "fetch on mount, flip a loading flag" loaders,
      // which this app uses deliberately. Kept visible as a warning instead of silenced per line.
      "react-hooks/set-state-in-effect": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-console": "off",
    },
  },
);
