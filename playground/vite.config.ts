import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { docgenPlugin } from "@oxc-ts-docgen/vite-plugin";
import { REACT_IGNORE_TYPES, DOM_IGNORE_TYPES } from "@oxc-ts-docgen/docgen";

export default defineConfig({
  plugins: [
    react(),
    docgenPlugin({
      ignoreTypes: [...REACT_IGNORE_TYPES, ...DOM_IGNORE_TYPES],
    }),
  ],
});
