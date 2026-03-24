import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.jsx"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...react.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["vite.config.js", "api/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["vite.config.js", "api/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  { ignores: ["dist/**", "node_modules/**", "android/**", "ios/**"] },
];
