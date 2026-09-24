/**
 * The default `StageRunners` this worker executes.
 *
 * `compose` is the real stage (`@shortreelcuts/render`). `script` is the
 * one place a real provider is wired in tonight: at boot, the model
 * connection is resolved from the environment once (`resolveModelConnection`,
 * never the database and never the plan — `docs/SPEC.md` §16). If one is
 * configured, script runs through the tested OpenAI-chat-completions
 * provider; if none is, it deliberately falls back to the deterministic
 * stub, whose own recorded reason says it is a stub. `voice`, `footage`,
 * `align` and `frames` remain the stubs (`docs/SPEC.md` §11 — no provider
 * for those slots is built yet).
 *
 * Kept as its own module so a test can pass a different `StageRunners`
 * (spies that count calls, or a synthetic-media compose) without the
 * job-running logic in `run.ts` knowing the difference. `options.env`
 * exists for the same reason: a test can supply a connection without
 * touching `process.env`.
 */
import {
  createOpenAiCompatibleScriptProvider,
  NoModelConnectionError,
  resolveModelConnection,
  type ModelConnectionEnv,
} from "@shortreelcuts/providers";
import { createScriptRunner, runAlign, runCompose, runFootage, runFrames, runScript, runVoice } from "@shortreelcuts/stages";
import type { StageRunners } from "@shortreelcuts/stages";

export interface DefaultRunnersOptions {
  /** The explicit environment to resolve a model connection from. Defaults to `process.env`, read once at worker boot. */
  readonly env?: ModelConnectionEnv;
}

/** Reads only the model-connection variables out of the process environment — never the whole environment object. */
function envFromProcess(): ModelConnectionEnv {
  return {
    SHORTREELCUTS_MODEL_BASE_URL: process.env["SHORTREELCUTS_MODEL_BASE_URL"],
    SHORTREELCUTS_MODEL_NAME: process.env["SHORTREELCUTS_MODEL_NAME"],
    SHORTREELCUTS_MODEL_API_KEY: process.env["SHORTREELCUTS_MODEL_API_KEY"],
  };
}

function scriptRunnerFrom(env: ModelConnectionEnv): StageRunners["script"] {
  try {
    return createScriptRunner(createOpenAiCompatibleScriptProvider(resolveModelConnection(env)));
  } catch (err) {
    // No connection is a supported configuration, not a failure to start: the stub is the documented fallback.
    if (err instanceof NoModelConnectionError) return runScript;
    throw err;
  }
}

export function defaultRunners(options: DefaultRunnersOptions = {}): StageRunners {
  return {
    script: scriptRunnerFrom(options.env ?? envFromProcess()),
    voice: runVoice,
    footage: runFootage,
    align: runAlign,
    frames: runFrames,
    compose: runCompose,
  };
}
