import { docgenPlugin } from "@synthfall/oxc-ts-docgen-vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    open: true,
  },
  plugins: [react(), docgenPlugin()],
});
