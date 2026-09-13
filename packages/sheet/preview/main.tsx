/**
 * A throwaway dev harness for looking at the decision sheet in an actual
 * browser — not part of the product. `apps/web` (docs/STRUCTURE.md) is
 * the real thing, and doesn't exist yet: this is ROADMAP step 3's own
 * instruction to spike the sheet "against stubbed stages" before the
 * pipeline is finished, made runnable with `npm run dev`.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/components/App.js";
import "../src/components/styles.css";
import { makePreviewRunners } from "./runners.js";

const banner = document.createElement("p");
banner.textContent =
  "Development preview, not the product. Script, voice, footage and alignment are stubbed; compose is faked too here (no ffmpeg in a browser) — see session.e2e.test.ts for the real one.";
banner.style.cssText = "background:#fff3cd;color:#664d03;padding:0.5rem 1rem;margin:0;font:13px sans-serif;text-align:center;";
document.body.prepend(banner);

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <App runners={makePreviewRunners()} workDir="/tmp/shortreelcuts-sheet-preview" makeSeed={() => 41207} />
  </StrictMode>,
);
