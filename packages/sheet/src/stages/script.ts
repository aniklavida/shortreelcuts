/**
 * The script stage — stubbed.
 *
 * No language model is wired in yet. `docs/SPEC.md` §11 settles which one
 * will be: whichever the user connects — a hosted API with their own key,
 * an agent subscription of theirs, or a model on their own hardware — all
 * first-class and reached through one neutral interface, not a provider
 * this project picks. This stub exists only so the decision sheet has a
 * script decision to render and invalidate — a real `ScriptProvider`
 * (`docs/SPEC.md` §7) drops in later behind the same `StageRunners.script`
 * signature.
 *
 * It still follows the one rule that matters for the sheet: it proposes
 * more than one hook, picks one, and records why — never a silent choice.
 */
import type { Beat, Plan, ScriptPlan } from "@shortreelcuts/plan";
import { makeRng, pick } from "./rng.js";
import type { DecisionCandidate, ScriptRunInput, StageResult } from "./types.js";

const HOOK_TEMPLATES: ReadonlyArray<(topic: string) => string> = [
  (topic) => `Ever wondered why ${topic}?`,
  (topic) => `Here's the thing nobody tells you about ${topic}.`,
  (topic) => `Let's talk about ${topic} for a second.`,
];

/** A rough topic phrase pulled from the prompt, for templating — not summarisation, just trimming. */
function topicFrom(prompt: string): string {
  const trimmed = prompt.trim().replace(/^a\s+video\s+about\s+/i, "").replace(/[.?!]+$/, "");
  return trimmed.length > 0 ? trimmed : prompt.trim();
}

/** One beat per ~12 seconds of target length, bounded to a readable 2–5 beats. */
function beatCount(targetSeconds: number): number {
  return Math.min(5, Math.max(2, Math.round(targetSeconds / 12)));
}

function beatFor(index: number, topic: string): Beat {
  const angle = [
    "where it starts",
    "how it actually works",
    "the part people get wrong",
    "why it matters",
    "what to take away",
  ][index % 5] as string;
  return {
    id: `b${index + 1}`,
    narration: `Beat ${index + 1}: ${angle}, about ${topic}.`,
    onScreen: angle[0]?.toUpperCase() + angle.slice(1),
    search: `${topic} ${angle}`.trim(),
  };
}

export async function runScript(input: ScriptRunInput): Promise<StageResult<Pick<Plan, "script">>> {
  const rng = makeRng(input.seed);
  const topic = topicFrom(input.brief.prompt);

  const hookOptions = HOOK_TEMPLATES.map((template, i) => ({
    id: `hook-${i}`,
    label: template(topic),
  }));
  const chosenHook = pick(rng, hookOptions);

  const candidates: DecisionCandidate[] = hookOptions.map((option) => ({
    id: option.id,
    label: option.label,
    chosen: option.id === chosenHook.id,
  }));

  const count = beatCount(input.brief.targetSeconds);
  const beats = Array.from({ length: count }, (_, i) => beatFor(i, topic));

  const script: ScriptPlan = {
    hook: chosenHook.label,
    beats,
    reason: `${count} beats fit a ${Math.round(input.brief.targetSeconds)}s ${input.brief.tone} video, and this hook leads with the question the prompt itself raises`,
  };

  return {
    patch: { script },
    candidates: { "script.hook": candidates },
  };
}
