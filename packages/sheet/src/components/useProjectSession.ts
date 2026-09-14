/**
 * The one piece of React state this whole sheet needs: a `ProjectSession`,
 * wired into components via a hook instead of a global store. There is no
 * server yet (`packages/db` doesn't exist) — this hook is what
 * `apps/web`'s job-status stream will eventually replace, without any
 * component below it changing.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { Plan, Stage } from "@shortreelcuts/plan";
import { buildDecisionGroups, type DecisionGroup } from "../decisions.js";
import type { CostEstimate } from "../cost.js";
import { ProjectSession, type Edit, type GenerateInput } from "../session.js";
import type { StageRunners } from "@shortreelcuts/stages";

export type StageStatus = "pending" | "running" | "done";

function freshProgress(): Record<Stage, StageStatus> {
  return { script: "pending", voice: "pending", footage: "pending", align: "pending", compose: "pending" };
}

export interface UseProjectSession {
  readonly plan: Plan | null;
  readonly groups: readonly DecisionGroup[];
  readonly progress: Record<Stage, StageStatus>;
  readonly costEstimate: CostEstimate | null;
  readonly isRunning: boolean;
  readonly videoPath: string | null;
  readonly error: string | null;
  generate(input: GenerateInput): Promise<void>;
  applyOverride(edits: readonly Edit[]): Promise<void>;
  applyRawPlan(rawPlan: unknown): Promise<void>;
  previewCost(edits: readonly Edit[]): CostEstimate;
}

export function useProjectSession(options: { runners: StageRunners; workDir: string }): UseProjectSession {
  const sessionRef = useRef<ProjectSession | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [progress, setProgress] = useState<Record<Stage, StageStatus>>(freshProgress());
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0); // bumps whenever candidatesFor()'s answers may have changed

  if (!sessionRef.current) {
    sessionRef.current = new ProjectSession({
      runners: options.runners,
      workDir: options.workDir,
      events: {
        onCostEstimate: (estimate) => {
          setCostEstimate(estimate);
          setProgress((prev) => {
            const next = { ...prev };
            for (const stage of estimate.stages) next[stage] = "pending";
            return next;
          });
        },
        onStageStart: (stage) => setProgress((prev) => ({ ...prev, [stage]: "running" })),
        onStageComplete: (stage) => setProgress((prev) => ({ ...prev, [stage]: "done" })),
      },
    });
  }
  const session = sessionRef.current;

  const generate = useCallback(
    async (input: GenerateInput) => {
      setIsRunning(true);
      setError(null);
      setProgress(freshProgress());
      try {
        const result = await session.generate(input);
        setPlan(result);
        setVideoPath(session.lastVideo?.path ?? null);
        setRevision((r) => r + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsRunning(false);
      }
    },
    [session],
  );

  const applyOverride = useCallback(
    async (edits: readonly Edit[]) => {
      setIsRunning(true);
      setError(null);
      try {
        const result = await session.applyOverride(edits);
        setPlan(result.plan);
        setVideoPath(session.lastVideo?.path ?? null);
        setRevision((r) => r + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsRunning(false);
      }
    },
    [session],
  );

  const applyRawPlan = useCallback(
    async (rawPlan: unknown) => {
      setIsRunning(true);
      setError(null);
      try {
        const result = await session.applyRawPlan(rawPlan);
        setPlan(result.plan);
        setVideoPath(session.lastVideo?.path ?? null);
        setRevision((r) => r + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsRunning(false);
      }
    },
    [session],
  );

  const previewCost = useCallback((edits: readonly Edit[]) => session.previewCost(edits).estimate, [session]);

  // `revision` is a deliberate extra dependency: it stands in for `session.candidatesFor`'s
  // answers, which live outside React state and change whenever a stage re-runs.
  const groups = useMemo(
    () => (plan ? buildDecisionGroups(plan, (rowId) => session.candidatesFor(rowId)) : []),
    [plan, session, revision],
  );

  return { plan, groups, progress, costEstimate, isRunning, videoPath, error, generate, applyOverride, applyRawPlan, previewCost };
}
