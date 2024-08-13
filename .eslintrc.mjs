/* eslint-env node */
export default {
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended-type-checked",
  ],
  env: {
    node: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: true,
    tsconfigRootDir: new URL(".", import.meta.url).pathname,
  },
  plugins: ["@typescript-eslint", "drizzle"],
  root: true,
  ignorePatterns: ["dist/", "drizzle.config.ts", ".eslintrc.cjs", "env.d.ts"],
};
