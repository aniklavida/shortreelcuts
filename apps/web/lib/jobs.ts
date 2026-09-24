/**
 * The real bodies behind the two job routes.
 *
 * Kept out of `app/` because `docs/STRUCTURE.md` says route files are entry
 * points only. Both call the `@shortreelcuts/worker` job API seam and nothing
 * else — `createJobAndEnqueue` to persist and queue, `getJobProgress` to read
 * back the same row the worker writes — so a browser refresh is just another
 * `GET` against the same job id.
 */
import { NextResponse } from "next/server";
import { STAGES } from "@shortreelcuts/plan";
import { createJobAndEnqueue, getJobProgress } from "@shortreelcuts/worker";
import { buildProgressStages, extractStageDecisions } from "./decisions.js";
import { getServerContext, type ServerContext } from "./server.js";

export interface CreateJobRequestBody {
  prompt?: string;
  targetSeconds?: number;
  tone?: string;
  seed?: number;
  brief?: {
    prompt: string;
    targetSeconds: number;
    tone: string;
  };
}

export async function handleCreateJob(
  req: Request,
  customContext?: ServerContext,
): Promise<Response> {
  try {
    const body = (await req.json()) as CreateJobRequestBody;
    const prompt = body.prompt ?? body.brief?.prompt;
    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: "prompt is required and must be non-empty" },
        { status: 400 },
      );
    }

    const targetSeconds = body.targetSeconds ?? body.brief?.targetSeconds ?? 20;
    const tone = body.tone ?? body.brief?.tone ?? "calm";
    const seed = typeof body.seed === "number" ? body.seed : Math.floor(Math.random() * 1_000_000);

    const input = {
      brief: {
        prompt: prompt.trim(),
        targetSeconds: Number(targetSeconds),
        tone: String(tone),
      },
      seed,
    };

    const context = customContext ?? (await getServerContext());
    const jobId = await createJobAndEnqueue(context.db, context.boss, input);

    return NextResponse.json(
      {
        id: jobId,
        status: "pending",
        seed,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function handleGetJob(
  _req: Request,
  jobId: string,
  customContext?: ServerContext,
): Promise<Response> {
  try {
    if (!jobId || typeof jobId !== "string") {
      return NextResponse.json({ error: "job id is required" }, { status: 400 });
    }

    const context = customContext ?? (await getServerContext());
    const progress = await getJobProgress(context.db, jobId);
    if (!progress) {
      return NextResponse.json({ error: `Job ${jobId} not found` }, { status: 404 });
    }

    const stageDecisions = extractStageDecisions(
      progress.plan,
      progress.completedStages,
      progress.candidates,
    );
    const stages = buildProgressStages(progress.status, progress.completedStages, stageDecisions);
    const decisions = Object.values(stageDecisions).flat();

    return NextResponse.json({
      id: progress.id,
      status: progress.status,
      completedStages: progress.completedStages,
      stages,
      decisions,
      percent: Math.round((progress.completedStages.length / STAGES.length) * 100),
      plan: progress.plan,
      candidates: progress.candidates,
      videoPath: progress.videoPath,
      errorMessage: progress.errorMessage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
