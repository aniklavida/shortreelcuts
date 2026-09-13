/**
 * Screen 2's sheet: every group from `buildDecisionGroups`, plus the
 * progress strip above them while a run is in flight. No `<form>`
 * anywhere in this tree — every change is its own explicit, previewed,
 * cancellable action, never a batch of fields submitted together.
 */
import type { Stage } from "@shortreelcuts/plan";
import type { CostEstimate } from "../cost.js";
import type { DecisionGroup } from "../decisions.js";
import type { Edit } from "../session.js";
import { DecisionGroupView } from "./DecisionGroupView.js";
import { ProgressStrip } from "./ProgressStrip.js";
import type { StageStatus } from "./useProjectSession.js";

export interface DecisionSheetProps {
  readonly plan: unknown;
  readonly groups: readonly DecisionGroup[];
  readonly progress: Record<Stage, StageStatus>;
  readonly isRunning: boolean;
  previewCost(edits: readonly Edit[]): CostEstimate;
  onApply(edits: readonly Edit[]): Promise<void>;
}

export function DecisionSheet({ plan, groups, progress, isRunning, previewCost, onApply }: DecisionSheetProps) {
  return (
    <div className="src-sheet" data-testid="decision-sheet">
      <ProgressStrip progress={progress} />
      {groups.map((group) => (
        <DecisionGroupView key={group.id} group={group} plan={plan} disabled={isRunning} previewCost={previewCost} onApply={onApply} />
      ))}
    </div>
  );
}
