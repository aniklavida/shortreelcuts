/**
 * The default `StageRunners` this worker executes: the same stubs the
 * decision sheet is built against for script, voice, footage and align
 * (`docs/SPEC.md` §11 — no provider exists yet for any of them), and the
 * one real stage, `compose`, via `@shortreelcuts/render`.
 *
 * Kept as its own module so a test can pass a different `StageRunners`
 * (spies that count calls, or a synthetic-media compose) without the
 * job-running logic in `run.ts` knowing the difference.
 */
import { runAlign, runCompose, runFootage, runFrames, runScript, runVoice } from "@shortreelcuts/stages";
import type { StageRunners } from "@shortreelcuts/stages";

export function defaultRunners(): StageRunners {
  return {
    script: runScript,
    voice: runVoice,
    footage: runFootage,
    align: runAlign,
    frames: runFrames,
    compose: runCompose,
  };
}

