import { defineConfig } from "tsup";

export default defineConfig([
  {
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
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    clean: false,
    sourcemap: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
