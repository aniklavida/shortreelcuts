/**
 * The provider-neutral seam `docs/SPEC.md` §5.1 and §7 describe: script
 * and voice are reached through one interface regardless of whether the
 * model behind it is a hosted API with the self-hoster's own key, an
 * agent subscription reached by signing in, or a model on their own
 * hardware. Nothing that calls a `ScriptProvider` or `VoiceProvider` can
 * tell which of the three supplied the answer.
 *
 * `ModelConnection`'s `"oauth"` kind exists so this type is honest about
 * the shape of the gap rather than pretending it is smaller than it is:
 * an OAuth connection needs a registered application per provider, which
 * nothing in this package creates. `connection.ts` never produces one —
 * only `"byok"` and `"local"` are resolved today.
 */
import type { Brief, ScriptPlan } from "@shortreelcuts/plan";

export type ModelConnectionKind = "byok" | "oauth" | "local";

export interface ModelConnection {
  readonly kind: ModelConnectionKind;
  /** An OpenAI-chat-completions-compatible base URL. A hosted BYOK provider, an OAuth-reached subscription and a local runtime (e.g. a self-hosted Ollama) all expose this same request shape, which is what lets one client serve all three. */
  readonly baseURL: string;
  readonly model: string;
  /** Absent for a local connection. Never logged and never written into a `Plan` — see `connection.ts` and the provider that consumes this. */
  readonly apiKey?: string;
}

export interface ScriptProvider {
  readonly id: string;
  generate(brief: Brief, seed: number): Promise<ScriptPlan>;
}

/** Minimal shapes for the voice slot's interface — no `VoiceProvider` implementation exists yet; see this package's README-equivalent note in `index.ts`. */
export interface VoiceDescriptor {
  readonly id: string;
  readonly label: string;
}

export interface NarrationLine {
  readonly id: string;
  readonly text: string;
}

export interface VoiceChoice {
  readonly voiceId: string;
  readonly rate: number;
}

export interface AudioTrack {
  readonly lineId: string;
  readonly path: string;
  readonly durationSeconds: number;
}

export interface VoiceProvider {
  readonly id: string;
  voices(): Promise<VoiceDescriptor[]>;
  speak(lines: readonly NarrationLine[], choice: VoiceChoice): Promise<AudioTrack[]>;
}
