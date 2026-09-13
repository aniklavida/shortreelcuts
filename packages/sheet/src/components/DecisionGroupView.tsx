/**
 * One collapsible group — "▸ Voice   Warm female, 1.0×   2 decisions"
 * collapsed, its rows expanded. Collapsed is the whole five-line summary
 * SPEC.md §8 describes for Screen 2: what a returning user reads in two
 * seconds to confirm nothing weird happened.
 */
import { useState } from "react";
import type { CostEstimate } from "../cost.js";
import type { DecisionGroup } from "../decisions.js";
import type { Edit } from "../session.js";
import { DecisionRowView } from "./DecisionRowView.js";

export interface DecisionGroupViewProps {
  readonly group: DecisionGroup;
  readonly plan: unknown;
  readonly disabled: boolean;
  readonly defaultExpanded?: boolean;
  previewCost(edits: readonly Edit[]): CostEstimate;
  onApply(edits: readonly Edit[]): Promise<void>;
}

export function DecisionGroupView({ group, plan, disabled, defaultExpanded = false, previewCost, onApply }: DecisionGroupViewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="src-group" data-testid={`group-${group.id}`}>
      <button type="button" className="src-group-header" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        <span>
          {expanded ? "▾" : "▸"} <span className="src-group-title">{group.title}</span>
          <span className="src-group-summary">{group.summary}</span>
        </span>
        <span className="src-group-count">{group.rows.length} decisions</span>
      </button>
      {expanded && (
        <div>
          {group.rows.map((row) => (
            <DecisionRowView key={row.id} row={row} plan={plan} disabled={disabled} previewCost={previewCost} onApply={onApply} />
          ))}
        </div>
      )}
    </div>
  );
}
