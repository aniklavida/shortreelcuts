/**
 * The orchestrator behind the decision sheet: runs the stub/real stages
 * in dependency order, and re-runs exactly what `@shortreelcuts/plan`'s
 * `invalidate()` says an override touched — nothing more.
 *
 * This is `apps/worker/run.ts` + `invalidate.ts` from `docs/STRUCTURE.md`,
 * collapsed into one in-process class because there is no queue or
 * worker yet (`packages/db` doesn't exist). Swapping this for a real
 * queued worker later changes where this class runs, not its contract.
 */
import { diffPaths, invalidate, parsePlan, type Brief, type Plan, type Stage } from "@shortreelcuts/plan";
import type { VideoFile } from "@shortreelcuts/render";
import { estimateRerun, type CostEstimate } from "./cost.js";
import { getAtPath, nearestReasonPath, setAllAtPaths } from "./patch.js";
import type { DecisionCandidate, StageRunners } from "./stages/types.js";

export interface SessionEvents {
  /** Fired once per override, before any stage in the returned set has started. This ordering is load-bearing — see the card's "cost before change" rule. */
  onCostEstimate?(estimate: CostEstimate, changedPaths: readonly string[]): void;
  onStageStart?(stage: Stage): void;
  onStageComplete?(stage: Stage, elapsedMs: number): void;
}

export interface GenerateInput {
  readonly brief: Brief;
  readonly seed: number;
}

/** One user-driven leaf edit: the plan path and its new value. */
export type Edit = readonly [path: string, value: unknown];

export interface OverrideResult {
  readonly plan: Plan;
  readonly ranStages: readonly Stage[];
  readonly estimate: CostEstimate;
  readonly video: VideoFile | undefined;
}

const REASON_OVERRIDE_TEXT = "Changed directly, overriding the earlier pick.";

/** Re-applies the user's edits (and updates the nearest enclosing `reason`) on top of whatever a stage just produced, so a stub stage's own default choice never silently discards what the user picked. */
function pinEdits(planBefore: Plan, draft: Plan, edits: readonly Edit[]): Plan {
  const reasonEdits: Edit[] = [];
  for (const [path] of edits) {
    const reasonPath = nearestReasonPath(planBefore, path);
    if (reasonPath) reasonEdits.push([reasonPath, REASON_OVERRIDE_TEXT]);
  }
  return setAllAtPaths(draft, [...edits, ...reasonEdits]);
}

async function timed<T>(
  stage: Stage,
  events: SessionEvents,
  run: () => Promise<T>,
): Promise<T> {
  events.onStageStart?.(stage);
  const start = Date.now();
  const result = await run();
  events.onStageComplete?.(stage, Date.now() - start);
  return result;
}

export class ProjectSession {
  private readonly runners: StageRunners;
  private readonly events: SessionEvents;
  private readonly workDir: string;
  private readonly versions: Plan[] = [];
  private readonly candidatesByRow = new Map<string, readonly DecisionCandidate[]>();
  private video: VideoFile | undefined;

  constructor(options: { runners: StageRunners; workDir: string; events?: SessionEvents | undefined }) {
    this.runners = options.runners;
    this.workDir = options.workDir;
    this.events = options.events ?? {};
  }

  /** The plan currently on screen. Throws before the first `generate()` — nothing is shown before a render, per the card's own rule. */
  get plan(): Plan {
    const current = this.versions[this.versions.length - 1];
    if (!current) throw new Error("no plan yet — call generate() first");
    return current;
  }

  get hasGenerated(): boolean {
    return this.versions.length > 0;
  }

  get history(): readonly Plan[] {
    return this.versions;
  }

  get lastVideo(): VideoFile | undefined {
    return this.video;
  }

  candidatesFor(rowId: string): readonly DecisionCandidate[] | undefined {
    return this.candidatesByRow.get(rowId);
  }

  private recordCandidates(candidates: Readonly<Record<string, readonly DecisionCandidate[]>>): void {
    for (const [rowId, options] of Object.entries(candidates)) {
      this.candidatesByRow.set(rowId, options);
    }
  }

  /** Reverts the visible plan to an earlier version without discarding history — SPEC.md §10 rule 5, "nothing is destroyed". */
  revertTo(index: number): Plan {
    const target = this.versions[index];
    if (!target) throw new Error(`no version at index ${index}`);
    this.versions.push(target);
    return target;
  }

  /** The first, full run: every stage, in dependency order. Nothing is invalidated against — there is no "before" yet. */
  async generate(input: GenerateInput): Promise<Plan> {
    let draft: Record<string, unknown> = { planVersion: 1, seed: input.seed, brief: input.brief };

    const scriptResult = await timed("script", this.events, () =>
      this.runners.script({ brief: input.brief, seed: input.seed }),
    );
    draft = { ...draft, ...scriptResult.patch };
    this.recordCandidates(scriptResult.candidates);

    this.events.onStageStart?.("voice");
    this.events.onStageStart?.("footage");
    const voiceStart = Date.now();
    const footageStart = Date.now();
    // `draft` is cast to `Plan` at each stage seam because it is only ever a *complete* Plan by the
    // end of this method (see the module doc on `StageRunners` — each runner reads only fields that
    // pipeline order already guarantees exist). `parsePlan` at the end is the real safety net.
    const [voiceResult, footageResult] = await Promise.all([
      this.runners.voice({ plan: draft as Plan }).then((r) => {
        this.events.onStageComplete?.("voice", Date.now() - voiceStart);
        return r;
      }),
      this.runners.footage({ plan: draft as Plan }).then((r) => {
        this.events.onStageComplete?.("footage", Date.now() - footageStart);
        return r;
      }),
    ]);
    draft = { ...draft, ...voiceResult.patch, ...footageResult.patch };
    this.recordCandidates(voiceResult.candidates);
    this.recordCandidates(footageResult.candidates);

    const alignResult = await timed("align", this.events, () => this.runners.align({ plan: draft as Plan }));
    draft = { ...draft, ...alignResult.patch };
    this.recordCandidates(alignResult.candidates);

    const composeResult = await timed("compose", this.events, () =>
      this.runners.compose({ plan: draft as Plan, workDir: this.workDir }),
    );
    draft = { ...draft, ...composeResult.patch };
    this.recordCandidates(composeResult.candidates);
    this.video = composeResult.video;

    const plan = parsePlan(draft);
    this.versions.push(plan);
    return plan;
  }

  /**
   * Applies one or more leaf edits, computes exactly which stages must
   * re-run via `diffPaths` + `invalidate()`, reports the cost of that
   * *before* running anything, then runs only those stages — in the
   * pipeline order `invalidate()` already returns them in.
   */
  async applyOverride(edits: readonly Edit[]): Promise<OverrideResult> {
    const before = this.plan;
    const after = setAllAtPaths(before, edits) as Plan;
    const withReasons = pinEdits(before, after, edits);

    const changedPaths = diffPaths(before, withReasons);
    const stages = invalidate(changedPaths);
    const estimate = estimateRerun(stages);

    // Cost is reported before a single stage runs — never after, and never interleaved with progress.
    this.events.onCostEstimate?.(estimate, changedPaths);

    let draft: Plan = withReasons;
    for (const stage of stages) {
      const result = await timed(stage, this.events, async () => {
        switch (stage) {
          case "script":
            return this.runners.script({ brief: draft.brief, seed: draft.seed });
          case "voice":
            return this.runners.voice({ plan: draft });
          case "footage":
            return this.runners.footage({ plan: draft });
          case "align":
            return this.runners.align({ plan: draft });
          case "compose":
            return this.runners.compose({ plan: draft, workDir: this.workDir });
        }
      });
      draft = { ...draft, ...result.patch } as Plan;
      this.recordCandidates(result.candidates);
      // Re-pin after every stage, not just once at the end: a downstream stage (e.g. align, which
      // reads plan.voice.rate) must see the user's actual override, not a stub's regenerated default.
      draft = pinEdits(before, draft, edits);
      if (stage === "compose") {
        this.video = (result as { video: VideoFile }).video;
      }
    }

    const plan = parsePlan(draft);
    this.versions.push(plan);
    return { plan, ranStages: stages, estimate, video: this.video };
  }
}

export { getAtPath };
