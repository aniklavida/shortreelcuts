/**
 * SPEC.md §10: "the sheet is the progress indicator, not a panel that
 * appears afterwards." This renders the same five stages `DecisionSheet`
 * will fill in, marked done/running/pending — during a `generate()` this
 * is the only thing on screen; during an override it sits above whichever
 * groups are mid re-run.
 */
import type { Stage } from "@shortreelcuts/plan";
import type { StageStatus } from "./useProjectSession.js";

const LABELS: Record<Stage, string> = {
  script: "Script",
  voice: "Voice",
  footage: "Footage",
  align: "Captions",
  compose: "Compose",
};

const MARKS: Record<StageStatus, string> = { done: "✓", running: "◐", pending: "·" };

export function ProgressStrip({ progress }: { progress: Record<Stage, StageStatus> }) {
  return (
    <div className="src-progress" role="status" aria-live="polite">
      {(Object.keys(LABELS) as Stage[]).map((stage) => (
        <div key={stage} data-stage={stage} data-status={progress[stage]}>
          {MARKS[progress[stage]]} {LABELS[stage]}
        </div>
      ))}
    </div>
  );
}
