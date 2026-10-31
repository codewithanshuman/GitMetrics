import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// relative base, so the build works on GitHub Pages under /GitMetrics/
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  server: { port: 4173 },
  preview: { port: 4173 },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30000 }
});
