// CRV · ESLint (PHASES E11). `npm run lint` corre esto; `npm run typecheck`
// sigue siendo tsc. Las reglas con información de tipos que se activan aquí
// apuntan a defectos reales de un backend con transacciones: una promesa sin
// await deja un COMMIT/ROLLBACK corriendo fuera de su cliente.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**", "**/dist/**", "**/dist-public/**", "build/**", "coverage/**",
      "data/**", "backups/**", "public/**", "tmp-analysis/**",
      // Comprobaciones sueltas de una sesión, como tmp-analysis: no son código del repo.
      "tmp/**",
      "web/tests/artifacts/**", "docs/**",
      // Worktrees y estado de Claude Code: es tooling, no código del repo
      // (sus archivos rompen el parser por doble tsconfig raíz).
      "**/.claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // Parámetros y variables de desestructuración con _ son intencionales.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-console": "off",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Configuración de herramientas sin tsconfig propio; los tests y
          // fixtures de la web y ops tienen el suyo (web/tests, ops).
          allowDefaultProject: ["vitest.config.ts", "vitest.chat.config.ts", "web/vite.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/await-thenable": "error",
    },
  },
  {
    // El código de biblioteca registra con pino (src/logger); solo la CLI
    // escribe en la terminal. Scripts y tests quedan libres.
    files: ["src/**/*.ts", "web/src/**/*.{ts,tsx}"],
    ignores: ["src/cli/**"],
    rules: { "no-console": "error" },
  },
  {
    files: ["web/src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Scripts de campaña y operación: leen JSON externo de forma puntual; `any`
    // no es el defecto que busca este lint (promesas sueltas, variables muertas).
    files: ["scripts/**/*.{ts,mts}", "ops/**/*.{ts,mts}"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // Extensión de Firefox del puente RYM: corre en el navegador y descarta a
    // propósito los errores de pestañas ya cerradas.
    files: ["ops/rym-resto/puente-ext/**/*.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
    rules: { "no-empty": ["error", { allowEmptyCatch: true }] },
  },
  {
    files: ["web/tests/**/*.{js,mjs,ts}", "web/server.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
