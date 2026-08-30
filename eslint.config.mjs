import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import i18next from "eslint-plugin-i18next";

export default tseslint.config(
  {
    ignores: ["dist/**", "scripts/**", "src/db/migrations/**"],
  },
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
      },
    },
  },
  pluginJs.configs.recommended,
  i18next.configs["flat/recommended"],
  ...tseslint.configs.strictTypeChecked
);
