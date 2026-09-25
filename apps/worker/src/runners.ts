/**
 * The default `StageRunners` this worker executes.
 *
 * `compose` is the real stage (`@shortreelcuts/render`). `script` and
 * `voice` are the two places real providers are wired in: at boot, the
 * model and voice connections are resolved from the environment once
 * (`resolveModelConnection` and `resolveVoiceConnection`, never the
 * database and never the plan — `docs/SPEC.md` §16). If configured, script
 * and voice run through the tested OpenAI-compatible providers
 * (`createOpenAiCompatibleScriptProvider`, `createOpenAiCompatibleVoiceProvider`);
 * if none is configured, each deliberately falls back to its deterministic
 * stub, whose own recorded reason says it is a stub. `footage`, `align`
 * and `frames` remain the stubs (`docs/SPEC.md` §11 — no provider for
 * those slots is built yet).
 *
 * Kept as its own module so a test can pass a different `StageRunners`
 * (spies that count calls, or a synthetic-media compose) without the
 * job-running logic in `run.ts` knowing the difference. `options.env`
 * exists for the same reason: a test can supply a connection without
 * touching `process.env`.
 */
import {
  createOpenAiCompatibleScriptProvider,
  createOpenAiCompatibleVoiceProvider,
  NoModelConnectionError,
  NoVoiceConnectionError,
  resolveModelConnection,
  resolveVoiceConnection,
  type MediaSink,
  type ModelConnectionEnv,
  type VoiceConnectionEnv,
} from "@shortreelcuts/providers";
import {
  createScriptRunner,
  createVoiceRunner,
  runAlign,
  runCompose,
  runFootage,
  runFrames,
  runScript,
  runVoice,
} from "@shortreelcuts/stages";
import type { StageRunners } from "@shortreelcuts/stages";

export interface DefaultRunnersOptions {
  /** The explicit environment to resolve model and voice connections from. Defaults to `process.env`, read once at worker boot. */
  readonly env?: ModelConnectionEnv & VoiceConnectionEnv;
  /** Optional media sink for voice audio storage. If omitted, an in-memory sink is used. */
  readonly mediaSink?: MediaSink;
}

/** Reads only the model-connection and voice-connection variables out of the process environment — never the whole environment object. */
function envFromProcess(): ModelConnectionEnv & VoiceConnectionEnv {
  return {
    SHORTREELCUTS_MODEL_BASE_URL: process.env["SHORTREELCUTS_MODEL_BASE_URL"],
    SHORTREELCUTS_MODEL_NAME: process.env["SHORTREELCUTS_MODEL_NAME"],
    SHORTREELCUTS_MODEL_API_KEY: process.env["SHORTREELCUTS_MODEL_API_KEY"],
    SHORTREELCUTS_VOICE_BASE_URL: process.env["SHORTREELCUTS_VOICE_BASE_URL"],
    SHORTREELCUTS_VOICE_NAME: process.env["SHORTREELCUTS_VOICE_NAME"],
    SHORTREELCUTS_VOICE_API_KEY: process.env["SHORTREELCUTS_VOICE_API_KEY"],
    SHORTREELCUTS_VOICE_IDS: process.env["SHORTREELCUTS_VOICE_IDS"],
  };
}

function makeFallbackMediaSink(): MediaSink {
  const store = new Map<string, Uint8Array>();
  return {
    async put(bytes: Uint8Array): Promise<string> {
      return `mem:${store.size}`;
    },
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

function voiceRunnerFrom(env: VoiceConnectionEnv, media: MediaSink): StageRunners["voice"] {
  try {
    return createVoiceRunner(createOpenAiCompatibleVoiceProvider(resolveVoiceConnection(env), media));
  } catch (err) {
    // No connection is a supported configuration, not a failure to start: the stub is the documented fallback.
    if (err instanceof NoVoiceConnectionError) return runVoice;
    throw err;
  }
}

export function defaultRunners(options: DefaultRunnersOptions = {}): StageRunners {
  const env = options.env ?? envFromProcess();
  const media = options.mediaSink ?? makeFallbackMediaSink();
  return {
    script: scriptRunnerFrom(env),
    voice: voiceRunnerFrom(env, media),
    footage: runFootage,
    align: runAlign,
    frames: runFrames,
    compose: runCompose,
  };
}
