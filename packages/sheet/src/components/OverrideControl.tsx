/**
 * "The smallest control that does the job" (`docs/SPEC.md` §8),
 * resolved from `DecisionRow.control` rather than one hard-coded form
 * per field — adding a stage later means adding a `control.kind` here at
 * most, never a new screen.
 *
 * The one rule every kind follows: changing the control never applies
 * anything by itself. It only updates a *pending* value, which is
 * previewed with `CostHint` — SPEC.md §9 rule 3, cost shown before the
 * change, not after. Applying is a separate, explicit action.
 */
import { useMemo, useState } from "react";
import type { CostEstimate } from "../cost.js";
import type { OverrideControl as OverrideControlSpec } from "../decisions.js";
import type { Edit } from "../session.js";
import type { DecisionCandidate } from "@shortreelcuts/stages";
import { CostHint } from "./CostHint.js";

export interface OverrideControlProps {
  readonly control: OverrideControlSpec;
  readonly currentValue: unknown;
  readonly candidates?: readonly DecisionCandidate[] | undefined;
  readonly disabled: boolean;
  previewCost(edits: readonly Edit[]): CostEstimate;
  onApply(edits: readonly Edit[]): Promise<void>;
  onCancel(): void;
}

function isChanged(pending: unknown, current: unknown): boolean {
  return JSON.stringify(pending) !== JSON.stringify(current);
}

export function OverrideControl({ control, currentValue, candidates, disabled, previewCost, onApply, onCancel }: OverrideControlProps) {
  const [pending, setPending] = useState<unknown>(currentValue);
  const changed = isChanged(pending, currentValue);
  const estimate = useMemo(
    () => (changed ? previewCost([[control.planPath, pending]]) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewCost is stable per session
    [pending, changed, control.planPath],
  );

  async function apply() {
    await onApply([[control.planPath, pending]]);
  }

  return (
    <div className="src-override">
      <Input control={control} pending={pending} setPending={setPending} candidates={candidates} disabled={disabled} />
      {estimate && <CostHint estimate={estimate} />}
      <div>
        <button type="button" className="src-apply" disabled={!changed || disabled} onClick={apply}>
          Apply
        </button>
        <button type="button" className="src-cancel" disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

interface InputProps {
  readonly control: OverrideControlSpec;
  readonly pending: unknown;
  readonly disabled: boolean;
  readonly candidates?: readonly DecisionCandidate[] | undefined;
  setPending(value: unknown): void;
}

function Input({ control, pending, setPending, candidates, disabled }: InputProps) {
  switch (control.kind) {
    case "select":
      // A select with candidates renders as the clickable strip the mockup shows — the rejected
      // options are the point. One with none (e.g. caption style, which nothing rejected) is a
      // plain dropdown.
      if (candidates && candidates.length > 0) {
        return (
          <div className="src-candidates" role="group" aria-label={`Change value (${candidates.length} options)`}>
            {candidates.map((option) => (
              <button
                key={option.id}
                type="button"
                className="src-candidate"
                aria-pressed={pending === option.id}
                disabled={disabled}
                onClick={() => setPending(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        );
      }
      return (
        <select aria-label="Change value" value={pending as string} disabled={disabled} onChange={(e) => setPending(e.target.value)}>
          {control.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case "text":
      return (
        <input
          type="text"
          aria-label="Change value"
          value={pending as string}
          disabled={disabled}
          onChange={(e) => setPending(e.target.value)}
        />
      );
    case "slider":
      return (
        <label>
          <input
            type="range"
            aria-label="Change value"
            min={control.min}
            max={control.max}
            step={control.step}
            value={pending as number}
            disabled={disabled}
            onChange={(e) => setPending(Number(e.target.value))}
          />
          {" "}
          {pending as number}
        </label>
      );
    case "toggle":
      return (
        <label>
          <input type="checkbox" aria-label="Change value" checked={pending as boolean} disabled={disabled} onChange={(e) => setPending(e.target.checked)} />
          {" "}
          {(pending as boolean) ? "On" : "Off"}
        </label>
      );
  }
}
