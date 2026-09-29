/**
 * The default `StageRunners` this worker executes.
 *
 * `compose` is the real stage (`@shortreelcuts/render`). `script`,
 * `voice` and `footage` are the three places real providers are wired in:
 * at boot, each connection is resolved from the environment once
 * (`resolveModelConnection`, `resolveVoiceConnection` and
 * `resolveFootageConnection`, never the database and never the plan —
 * `docs/SPEC.md` §16). If configured, each slot runs through its tested
 * real provider; if none is configured, each deliberately falls back to
 * its deterministic stub, whose own recorded reason says it is a stub.
 *
 * The footage slot differs in one way, on purpose: a stock library is
 * bring-your-own-key with no credential-free half, so "provider named but
 * key missing" and "provider named but unknown to this build" are
 * misconfigurations that throw here rather than resolving to the stub. A
 * self-hoster who asked for Pexels must not receive a video of synthetic
 * clip ids.
 *
 * `align` and `frames` remain the stubs (`docs/SPEC.md` §11 — no
 * alignment provider is built yet).
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
  createStockFootageProvider,
  NoFootageConnectionError,
  NoModelConnectionError,
  NoVoiceConnectionError,
  resolveFootageConnection,
  resolveModelConnection,
  resolveVoiceConnection,
  type FootageConnectionEnv,
  type MediaSink,
  type ModelConnectionEnv,
  type VoiceConnectionEnv,
} from "@shortreelcuts/providers";
import {
  createScriptRunner,
  createVoiceRunner,
  runAlign,
  runCompose,
  createFootageRunner,
  runFootage,
  runFrames,
  runScript,
  runVoice,
} from "@shortreelcuts/stages";
import type { StageRunners } from "@shortreelcuts/stages";

export interface DefaultRunnersOptions {
  /** The explicit environment to resolve model, voice and footage connections from. Defaults to `process.env`, read once at worker boot. */
  readonly env?: ModelConnectionEnv & VoiceConnectionEnv & FootageConnectionEnv;
  /** Optional media sink for voice audio storage. If omitted, an in-memory sink is used. */
  readonly mediaSink?: MediaSink;
}

/** Reads only the connection variables out of the process environment — never the whole environment object. */
function envFromProcess(): ModelConnectionEnv & VoiceConnectionEnv & FootageConnectionEnv {
  return {
    SHORTREELCUTS_MODEL_BASE_URL: process.env["SHORTREELCUTS_MODEL_BASE_URL"],
    SHORTREELCUTS_MODEL_NAME: process.env["SHORTREELCUTS_MODEL_NAME"],
    SHORTREELCUTS_MODEL_API_KEY: process.env["SHORTREELCUTS_MODEL_API_KEY"],
    SHORTREELCUTS_VOICE_BASE_URL: process.env["SHORTREELCUTS_VOICE_BASE_URL"],
    SHORTREELCUTS_VOICE_NAME: process.env["SHORTREELCUTS_VOICE_NAME"],
    SHORTREELCUTS_VOICE_API_KEY: process.env["SHORTREELCUTS_VOICE_API_KEY"],
    SHORTREELCUTS_VOICE_IDS: process.env["SHORTREELCUTS_VOICE_IDS"],
    SHORTREELCUTS_FOOTAGE_PROVIDER: process.env["SHORTREELCUTS_FOOTAGE_PROVIDER"],
    SHORTREELCUTS_FOOTAGE_API_KEY: process.env["SHORTREELCUTS_FOOTAGE_API_KEY"],
    SHORTREELCUTS_FOOTAGE_BASE_URL: process.env["SHORTREELCUTS_FOOTAGE_BASE_URL"],
  };
}


function makeFallbackMediaSink(): MediaSink {
  const store = new Map<string, Uint8Array>();
  return {
    async put(bytes: Uint8Array): Promise<string> {
      const key = `mem:${store.size}`;
      store.set(key, bytes);
      return key;
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

function footageRunnerFrom(env: FootageConnectionEnv): StageRunners["footage"] {
  try {
    return createFootageRunner(createStockFootageProvider(resolveFootageConnection(env)));
  } catch (err) {
    // Only "no provider chosen at all" is a supported configuration. A named
    // provider with no key, or a name this build has no adapter for, throws
    // on through: a self-hoster who asked for a stock library must not be
    // handed a video of synthetic clip ids without being told.
    if (err instanceof NoFootageConnectionError) return runFootage;
    throw err;
  }
}

export function defaultRunners(options: DefaultRunnersOptions = {}): StageRunners {
  const env = options.env ?? envFromProcess();
  const media = options.mediaSink ?? makeFallbackMediaSink();
  return {
    script: scriptRunnerFrom(env),
    voice: voiceRunnerFrom(env, media),
    footage: footageRunnerFrom(env),
    align: runAlign,
    frames: runFrames,
    compose: runCompose,
  };
}
