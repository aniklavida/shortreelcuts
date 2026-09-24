/**
 * The script stage.
 *
 * Two runners live here, and `apps/worker`'s default runners pick between
 * them once, at boot (`runners.ts`), from the environment alone:
 *
 * - `createScriptRunner(provider)` drives a real `ScriptProvider` — the
 *   provider-neutral seam `docs/SPEC.md` §7 describes, so a hosted
 *   bring-your-own-key model and a model running on the self-hoster's own
 *   hardware are the same call. The provider returns the script the
 *   connected model wrote; the runner records which connection produced
 *   it in the plan reason. The `ScriptProvider` contract returns one
 *   script, not a set of candidate hooks, so there are no rejected
 *   alternatives for the stage to weigh — the reason says so rather than
 *   inventing candidates nobody considered.
 * - `runScript` is the deterministic stub, and the explicit fallback when
 *   no model connection is configured. It proposes more than one hook,
 *   picks one and records why, and its plan reason plainly says it is a
 *   stub — never a silent downgrade that could be mistaken for a real
 *   generation.
 *
 * A `ScriptProviderParseError` from the real provider is re-thrown as a
 * `ScriptGenerationError`: a stage that cannot get a real script fails
 * loudly instead of quietly falling back to the stub (`docs/SPEC.md` §7
 * rule 1 — a plan field either came from a real decision or the stage
 * fails, never a third option).
 */
import type { Beat, Plan, ScriptPlan } from "@shortreelcuts/plan";
import { ScriptProviderParseError, type ScriptProvider } from "@shortreelcuts/providers";
import { makeRng, pick } from "./rng.js";
import type { DecisionCandidate, ScriptRunInput, StageResult, StageRunners } from "./types.js";

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

/**
 * The deterministic stub. Its reason always names itself as a stub, so a
 * plan produced without a model connection cannot be read as one that had
 * one — the honesty requirement is in the plan, not only in a comment.
 */
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
    reason: `Deterministic script stub — no model was called. ${count} beats fit a ${Math.round(input.brief.targetSeconds)}s ${input.brief.tone} video, and this hook leads with the question the prompt itself raises`,
  };

  return {
    patch: { script },
    candidates: { "script.hook": candidates },
  };
}

/** Thrown when a real provider's output cannot become a plan — see the module header. Never swallowed into the stub. */
export class ScriptGenerationError extends Error {
  constructor(providerId: string, cause: unknown) {
    super(
      `the connected model (${providerId}) did not return a usable script; ` +
        "the stage failed rather than falling back to the deterministic stub",
    );
    this.name = "ScriptGenerationError";
    this.cause = cause;
  }
}

/**
 * The real-provider runner. The provider's returned `ScriptPlan` is the
 * decision; the only thing this stage adds is provenance in the reason,
 * so the sheet can distinguish a model generation from the stub, and a
 * single candidate for `script.hook` recording what the model chose.
 *
 * The candidate's `id` is the hook text itself (not a slug) on purpose:
 * the sheet's candidate strip writes the candidate `id` back to
 * `script.hook`, and the hook *is* the value at that plan path.
 */
export function createScriptRunner(provider: ScriptProvider): StageRunners["script"] {
  return async (input) => {
    let script: ScriptPlan;
    try {
      script = await provider.generate(input.brief, input.seed);
    } catch (err) {
      if (err instanceof ScriptProviderParseError) {
        throw new ScriptGenerationError(provider.id, err);
      }
      throw err;
    }

    const reason = `${script.reason} — generated by the connected model (${provider.id}); it returns one script, so there are no rejected hook alternatives to weigh here.`;

    return {
      patch: { script: { ...script, reason } },
      candidates: {
        "script.hook": [{ id: script.hook, label: script.hook, chosen: true }],
      },
    };
  };
}
