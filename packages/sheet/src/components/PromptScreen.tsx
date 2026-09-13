/**
 * Screen 1. One text box, a duration chip, a Generate button. Nothing
 * else — no accordion labelled "Advanced". The card's rule: a control
 * reachable before the first render is a bug against the specification.
 * `App.tsx` never mounts anything else alongside this component before
 * a plan exists, so that rule is structural, not a matter of not adding
 * more controls here later.
 */
import { useState } from "react";

const DURATIONS = [15, 30, 45] as const;

/** A rough stand-in for tone inference — no script provider exists to ask. See `docs/DECISIONS.md`. */
function guessTone(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (/(exciting|amazing|huge|energetic|urgent|fast)/.test(lower)) return "energetic";
  if (/(sad|loss|grief|difficult)/.test(lower)) return "gentle";
  return "calm";
}

export interface PromptScreenProps {
  readonly isGenerating: boolean;
  onGenerate(input: { prompt: string; targetSeconds: number; tone: string }): void;
}

export function PromptScreen({ isGenerating, onGenerate }: PromptScreenProps) {
  const [prompt, setPrompt] = useState("");
  const [targetSeconds, setTargetSeconds] = useState<(typeof DURATIONS)[number]>(30);

  const canGenerate = prompt.trim().length > 0 && !isGenerating;

  return (
    <div className="src-prompt">
      <p>Describe the video you want.</p>
      <textarea
        aria-label="Video prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="a video about why the sky is blue"
      />
      <div className="src-chips" role="group" aria-label="Target length">
        {DURATIONS.map((seconds) => (
          <button
            key={seconds}
            type="button"
            className="src-chip"
            aria-pressed={targetSeconds === seconds}
            onClick={() => setTargetSeconds(seconds)}
          >
            {seconds}s
          </button>
        ))}
      </div>
      <button
        type="button"
        className="src-generate"
        disabled={!canGenerate}
        onClick={() => onGenerate({ prompt: prompt.trim(), targetSeconds, tone: guessTone(prompt) })}
      >
        {isGenerating ? "Generating…" : "Generate"}
      </button>
    </div>
  );
}
