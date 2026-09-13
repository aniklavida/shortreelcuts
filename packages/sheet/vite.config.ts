import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "preview",
  plugins: [react()],
  resolve: {
    alias: {
      // See preview/shims/shortreelcuts-plan.ts for why this is needed.
      "@shortreelcuts/plan": new URL("./preview/shims/shortreelcuts-plan.ts", import.meta.url).pathname,
    },
  },
});
