import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    target: "node22.12",
    dts: {
      compilerOptions: {
        composite: false,
        ignoreDeprecations: "6.0",
      },
    },
    clean: true,
    sourcemap: true,
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    target: "node22.12",
    clean: false,
    sourcemap: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
