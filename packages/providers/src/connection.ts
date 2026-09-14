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
 */
import type { ModelConnection } from "./types.js";

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
