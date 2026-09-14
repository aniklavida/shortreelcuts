import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    // The sheet's React components need a DOM; everything else in the workspace is pure Node.
    environmentMatchGlobs: [["packages/sheet/src/**/*.test.tsx", "jsdom"]],
    setupFiles: ["packages/sheet/src/testing/setup-dom.ts"],
    include: ["packages/*/src/**/*.test.{ts,tsx}", "apps/*/src/**/*.test.{ts,tsx}"],
  },
});
