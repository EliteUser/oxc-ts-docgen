import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: {
    compilerOptions: {
      composite: false,
      ignoreDeprecations: "6.0",
    },
  },
  clean: true,
  sourcemap: true,
  external: ["vite", "@oxc-ts-docgen/docgen"],
});
