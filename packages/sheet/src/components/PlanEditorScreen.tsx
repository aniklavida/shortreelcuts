/**
 * Screen 3: the raw plan, editable, with a re-render button. For the
 * power user, for the bug report, and as a promise that nothing is
 * hidden — SPEC.md §9. It is the last screen for a reason: it is where
 * someone who already knows exactly what they want goes directly, not
 * where anyone is steered.
 */
import { useState } from "react";

export interface PlanEditorScreenProps {
  readonly plan: unknown;
  readonly disabled: boolean;
  onReRender(rawPlan: unknown): Promise<void>;
}

export function PlanEditorScreen({ plan, disabled, onReRender }: PlanEditorScreenProps) {
  const [text, setText] = useState(() => JSON.stringify(plan, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  async function reRender() {
    try {
      const parsed = JSON.parse(text);
      setParseError(null);
      await onReRender(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="src-plan-editor">
      <p>The full plan. Nothing here is hidden from the sheet, and nothing on the sheet is hidden from here.</p>
      <textarea aria-label="Plan JSON" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {parseError && <p className="src-error">{parseError}</p>}
      <button type="button" className="src-generate" disabled={disabled} onClick={reRender}>
        Re-render
      </button>
    </div>
  );
}
