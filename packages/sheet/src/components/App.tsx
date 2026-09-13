/**
 * The three screens, and the discipline between them: nothing but the
 * prompt exists before a plan does, the sheet is screen 2, the raw plan
 * is screen 3 and reached only by a deliberate tab, never by default.
 */
import { useState } from "react";
import type { StageRunners } from "../stages/types.js";
import { DecisionSheet } from "./DecisionSheet.js";
import { PlanEditorScreen } from "./PlanEditorScreen.js";
import { PromptScreen } from "./PromptScreen.js";
import { useProjectSession } from "./useProjectSession.js";

export interface AppProps {
  readonly runners: StageRunners;
  readonly workDir: string;
  /** A random seed generator, injectable so tests and the fixture preview can pin it. */
  makeSeed?(): number;
}

type Screen = "sheet" | "plan";

export function App({ runners, workDir, makeSeed = () => Math.floor(Math.random() * 1_000_000) }: AppProps) {
  const { plan, groups, progress, isRunning, videoPath, error, generate, applyOverride, applyRawPlan, previewCost } = useProjectSession({
    runners,
    workDir,
  });
  const [screen, setScreen] = useState<Screen>("sheet");

  if (!plan) {
    return (
      <div className="src-app">
        <PromptScreen
          isGenerating={isRunning}
          onGenerate={({ prompt, targetSeconds, tone }) => {
            void generate({ brief: { prompt, targetSeconds, tone }, seed: makeSeed() });
          }}
        />
        {error && <p className="src-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="src-app">
      <nav>
        <button type="button" onClick={() => setScreen("sheet")} aria-current={screen === "sheet"}>
          Video &amp; decisions
        </button>{" "}
        <button type="button" onClick={() => setScreen("plan")} aria-current={screen === "plan"}>
          Plan
        </button>
      </nav>

      {videoPath && (
        <p data-testid="video-path">
          Rendered: <code>{videoPath}</code>
        </p>
      )}
      {error && <p className="src-error">{error}</p>}

      {screen === "sheet" ? (
        <DecisionSheet plan={plan} groups={groups} progress={progress} isRunning={isRunning} previewCost={previewCost} onApply={applyOverride} />
      ) : (
        <PlanEditorScreen plan={plan} disabled={isRunning} onReRender={applyRawPlan} />
      )}
    </div>
  );
}
