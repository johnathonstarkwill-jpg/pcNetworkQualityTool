import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so packaged builds load assets over file:// — an absolute
  // "/assets/..." resolves to the filesystem root under file:// and white-screens.
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
