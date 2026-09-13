/**
 * One row: what was chosen, why, and — the smallest control that does the
 * job. A row with rejected candidates (a clip, a hook, a voice) shows them
 * at a glance, because "the four clips it did not pick" is the card's own
 * example of what turns "trust me" into something you can disagree with.
 * A row without candidates (a slider, a toggle, free text) keeps its
 * control behind a "Change" disclosure — SPEC.md §9 rule 6, progressive
 * disclosure is depth, not hiding, and a plain sentence is the shallowest
 * depth for a field nobody is currently questioning.
 */
import { useState } from "react";
import type { CostEstimate } from "../cost.js";
import type { DecisionRow } from "../decisions.js";
import type { Edit } from "../session.js";
import { OverrideControl } from "./OverrideControl.js";
import { getAtPath } from "../patch.js";

export interface DecisionRowViewProps {
  readonly row: DecisionRow;
  readonly plan: unknown;
  readonly disabled: boolean;
  previewCost(edits: readonly Edit[]): CostEstimate;
  onApply(edits: readonly Edit[]): Promise<void>;
}

export function DecisionRowView({ row, plan, disabled, previewCost, onApply }: DecisionRowViewProps) {
  const [changing, setChanging] = useState(false);

  const glanceable = row.control?.kind === "select" && (row.candidates?.length ?? 0) > 0;

  return (
    <div className="src-row">
      <p className="src-row-sentence">
        <strong>{row.label}:</strong> {row.chosen}
        {row.control && !glanceable && (
          <button type="button" className="src-change-link" onClick={() => setChanging((c) => !c)} disabled={disabled}>
            {changing ? "Never mind" : "Change"}
          </button>
        )}
      </p>
      <p className="src-row-reason">{row.reason}</p>

      {glanceable && row.control && (
        <OverrideControl
          control={row.control}
          currentValue={getAtPath(plan, row.control.planPath)}
          candidates={row.candidates}
          disabled={disabled}
          previewCost={previewCost}
          onApply={async (edits) => {
            await onApply(edits);
          }}
          onCancel={() => {
            /* a glanceable control has nothing to close back to — clicking the chosen option again is its own cancel */
          }}
        />
      )}

      {!glanceable && changing && row.control && (
        <OverrideControl
          control={row.control}
          currentValue={getAtPath(plan, row.control.planPath)}
          candidates={row.candidates}
          disabled={disabled}
          previewCost={previewCost}
          onApply={async (edits) => {
            await onApply(edits);
            setChanging(false);
          }}
          onCancel={() => setChanging(false)}
        />
      )}

      {!row.control && <p className="src-readonly-note">Not directly editable yet.</p>}
    </div>
  );
}
