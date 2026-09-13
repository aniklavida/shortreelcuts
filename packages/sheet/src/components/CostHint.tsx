/**
 * SPEC.md §9 rule 3: "the cost of a change is shown before the change."
 * This renders next to a pending edit, before the person has clicked
 * Apply — see `OverrideControl`, which computes it synchronously from
 * `previewCost` the moment a pending value differs from what's chosen.
 */
import type { CostEstimate } from "../cost.js";

export function CostHint({ estimate }: { estimate: CostEstimate }) {
  if (estimate.stages.length === 0) return null;
  return (
    <p className="src-cost-hint" data-testid="cost-hint">
      {estimate.headline}
      {estimate.stages.length > 1 ? ` (${estimate.path})` : ""}
    </p>
  );
}
