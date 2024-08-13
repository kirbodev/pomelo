import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import i18next from "eslint-plugin-i18next";

export default tseslint.config(
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
      },
    },
    ignores: ["dist/**", "scripts/**"],
  },
  pluginJs.configs.recommended,
  ...i18next.configs.recommended,
  ...tseslint.configs.strictTypeChecked
);
