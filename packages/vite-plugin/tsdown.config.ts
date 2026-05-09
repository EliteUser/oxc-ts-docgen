import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  target: "node22.12",
  dts: {
    compilerOptions: {
      composite: false,
    },
  },
  clean: true,
  deps: {
    neverBundle: ["vite", "@synthfall/oxc-ts-docgen"],
  },
});
