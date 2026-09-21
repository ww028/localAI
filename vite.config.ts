import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        offscreen: "offscreen.html",
      },
      output: {
        manualChunks(id) {
          return id.indexOf("node_modules") >= 0 ? "vendor" : undefined;
        },
      },
    },
  },
});
