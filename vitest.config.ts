import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@synthfall/oxc-ts-docgen",
        replacement: fileURLToPath(new URL("./packages/docgen/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    globals: false,
    include: ["packages/*/tests/**/*.test.ts", "playground/src/**/*.test.ts"],
  },
});
