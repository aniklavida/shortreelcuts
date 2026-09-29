/**
 * Resolves which of a self-hoster's model connections is configured, from
 * the environment only — never the database, never the plan. `docs/SPEC.md`
 * §16: "Secrets live in `.env` and never in the database, the plan
 * document, or a log line."
 *
 * Deliberately a pure function of an explicit env object rather than
 * reading `process.env` itself: it is what makes "no credential in the
 * database, exported plan, or logs" testable without a real environment,
 * and it is what a real `apps/worker` startup path would call once, at
 * boot, exactly the way `docs/SPEC.md` §16 assumes secrets are read.
 *
 * Precedence: an API key means bring-your-own-key against the configured
 * base URL. No key, but a base URL, is a local runtime reached with no
 * credential — a self-hosted Ollama on the same machine looks exactly
 * like this. Neither set is a configuration error, surfaced as a thrown
 * error rather than a silent fallback to nothing connected.
 *
 * `resolveVoiceConnection` follows the same rule for the voice slot, with
 * its own `SHORTREELCUTS_VOICE_*` variables: script and voice are separate
 * slots a self-hoster may point at different models, so sharing one set of
 * variables would silently forbid that.
 */
import type { FootageConnection, ModelConnection, VoiceConnection } from "./types.js";
import { KNOWN_STOCK_PROVIDERS } from "./footage/remoteStock.js";

export class NoModelConnectionError extends Error {
  constructor() {
    super(
      "No model connection is configured. Set SHORTREELCUTS_MODEL_BASE_URL " +
        "and SHORTREELCUTS_MODEL_NAME (plus SHORTREELCUTS_MODEL_API_KEY for a " +
        "hosted key) or point them at a local runtime.",
    );
    this.name = "NoModelConnectionError";
  }
}

export interface ModelConnectionEnv {
  readonly SHORTREELCUTS_MODEL_BASE_URL?: string | undefined;
  readonly SHORTREELCUTS_MODEL_NAME?: string | undefined;
  readonly SHORTREELCUTS_MODEL_API_KEY?: string | undefined;
}

export function resolveModelConnection(env: ModelConnectionEnv): ModelConnection {
  const baseURL = env.SHORTREELCUTS_MODEL_BASE_URL;
  const model = env.SHORTREELCUTS_MODEL_NAME;
  if (!baseURL || !model) throw new NoModelConnectionError();

  const apiKey = env.SHORTREELCUTS_MODEL_API_KEY;
  if (apiKey) {
    return { kind: "byok", baseURL, model, apiKey };
  }
  return { kind: "local", baseURL, model };
}

export class NoVoiceConnectionError extends Error {
  constructor() {
    super(
      "No voice connection is configured. Set SHORTREELCUTS_VOICE_BASE_URL and " +
        "SHORTREELCUTS_VOICE_NAME (plus SHORTREELCUTS_VOICE_API_KEY for a hosted " +
        "key) or point them at a local server you already run.",
    );
    this.name = "NoVoiceConnectionError";
  }
}

export interface VoiceConnectionEnv {
  readonly SHORTREELCUTS_VOICE_BASE_URL?: string | undefined;
  readonly SHORTREELCUTS_VOICE_NAME?: string | undefined;
  readonly SHORTREELCUTS_VOICE_API_KEY?: string | undefined;
  /** Comma-separated voice ids the endpoint exposes. Display-only; never a credential. */
  readonly SHORTREELCUTS_VOICE_IDS?: string | undefined;
}

function parseVoiceIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export function resolveVoiceConnection(env: VoiceConnectionEnv): VoiceConnection {
  const baseURL = env.SHORTREELCUTS_VOICE_BASE_URL;
  const model = env.SHORTREELCUTS_VOICE_NAME;
  if (!baseURL || !model) throw new NoVoiceConnectionError();

  const apiKey = env.SHORTREELCUTS_VOICE_API_KEY;
  const voiceIds = parseVoiceIds(env.SHORTREELCUTS_VOICE_IDS);
  if (apiKey) {
    return { kind: "byok", baseURL, model, apiKey, voiceIds };
  }
  return { kind: "local", baseURL, model, voiceIds };
}

/**
 * The footage slot follows the same rule from the environment only, with
 * one deliberate difference in how absence is reported.
 *
 * Script and voice have a "local" half that needs no credential, so
 * "nothing configured" is a supported configuration there and the worker
 * falls back to a stub. A stock library has no such half: it is always
 * bring-your-own-key. So the three cases are kept apart:
 *
 * - **No `SHORTREELCUTS_FOOTAGE_PROVIDER`** — nothing was chosen.
 *   `NoFootageConnectionError`, which the worker treats as the documented
 *   fallback to the deterministic footage stub.
 * - **A provider chosen but no key** — `MissingFootageApiKeyError`. Not
 *   swallowed into the stub, because a self-hoster who named their library
 *   and forgot the key would otherwise get a video of synthetic clip ids
 *   and a plan saying the footage stage chose nothing real. That is a
 *   misconfiguration and it fails at boot.
 * - **A provider this build has no adapter for** — `UnknownFootageProviderError`,
 *   also loud. Nothing here guesses which library the self-hoster meant.
 */
export class NoFootageConnectionError extends Error {
  constructor() {
    super(
      `No stock footage provider is configured. Set SHORTREELCUTS_FOOTAGE_PROVIDER to one of ` +
        `${KNOWN_STOCK_PROVIDERS.join(", ")} and SHORTREELCUTS_FOOTAGE_API_KEY to that library's own free-tier key.`,
    );
    this.name = "NoFootageConnectionError";
  }
}

export class MissingFootageApiKeyError extends Error {
  constructor(providerId: string) {
    super(
      `SHORTREELCUTS_FOOTAGE_PROVIDER is "${providerId}" but SHORTREELCUTS_FOOTAGE_API_KEY is not set. ` +
        "Set it, or unset the provider to use the deterministic footage stub deliberately.",
    );
    this.name = "MissingFootageApiKeyError";
  }
}

export class UnknownFootageProviderError extends Error {
  constructor(providerId: string) {
    super(
      `SHORTREELCUTS_FOOTAGE_PROVIDER is "${providerId}", which this build has no adapter for. ` +
        `This build ships ${KNOWN_STOCK_PROVIDERS.join(" and ")}.`,
    );
    this.name = "UnknownFootageProviderError";
  }
}

export interface FootageConnectionEnv {
  readonly SHORTREELCUTS_FOOTAGE_PROVIDER?: string | undefined;
  readonly SHORTREELCUTS_FOOTAGE_API_KEY?: string | undefined;
  /**
   * Optional override of the library's API root, for a self-hoster behind
   * a caching proxy or a self-hosted mirror. Unset in the normal case, in
   * which case the library's own public host is used. Never a credential.
   */
  readonly SHORTREELCUTS_FOOTAGE_BASE_URL?: string | undefined;
}

function isKnownFootageProvider(value: string): value is FootageConnection["provider"] {
  return (KNOWN_STOCK_PROVIDERS as readonly string[]).includes(value);
}

export function resolveFootageConnection(env: FootageConnectionEnv): FootageConnection {
  const provider = env.SHORTREELCUTS_FOOTAGE_PROVIDER?.trim();
  if (!provider) throw new NoFootageConnectionError();
  if (!isKnownFootageProvider(provider)) throw new UnknownFootageProviderError(provider);

  const apiKey = env.SHORTREELCUTS_FOOTAGE_API_KEY?.trim();
  if (!apiKey) throw new MissingFootageApiKeyError(provider);

  const baseURL = env.SHORTREELCUTS_FOOTAGE_BASE_URL?.trim();
  return baseURL ? { kind: "byok", provider, apiKey, baseURL } : { kind: "byok", provider, apiKey };
}

