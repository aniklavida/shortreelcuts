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
import type { Brief, FootageClip, GeneratedFootage, MotionFootage, ScriptPlan, StockFootage } from "@shortreelcuts/plan";

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

/**
 * A `VoiceConnection` is resolved from the environment only, the same rule
 * `ModelConnection` follows (`connection.ts`, `docs/SPEC.md` §16). It is a
 * separate type from `ModelConnection` on purpose: the script model and the
 * speech model are two different things a self-hoster may connect to two
 * different places, so they get two sets of environment variables rather
 * than sharing one.
 */
export interface VoiceConnection {
  readonly kind: ModelConnectionKind;
  /** An OpenAI-audio-speech-compatible base URL. A hosted BYOK provider, an OAuth-reached subscription and a local server the self-hoster already runs (their own Piper/Coqui/other instance, behind a compatible API) all expose this same request shape. */
  readonly baseURL: string;
  /** The speech model to request. */
  readonly model: string;
  /** Absent for a local connection. Never logged and never written into a `Plan` — see `connection.ts` and the provider that consumes this. */
  readonly apiKey?: string;
  /** The voice ids this endpoint exposes, for the override control (`docs/SPEC.md` §7 capability declaration). Not credentials — safe to surface. */
  readonly voiceIds: readonly string[];
}

/** The voice slot's interface — no `VoiceProvider` implementation ships an engine; see `voice/openAiCompatible.ts`. */
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

/**
 * A write-only destination for media bytes. `docs/SPEC.md` §7.3: "No
 * provider touches the database, the queue or the filesystem. In, out, and
 * a `MediaStore` handle if it needs bytes." A provider hands bytes to this
 * and receives an opaque key back; it never learns or chooses where they
 * landed, which is what keeps the second implementation of a slot from
 * being a rewrite. A `MediaStore` implementing this is the caller's job.
 */
export interface MediaSink {
  /** Stores the bytes and returns a stable key they can later be read back under. */
  put(bytes: Uint8Array, contentType: string): Promise<string>;
}

export interface MediaStore extends MediaSink {
  /** Retrieves previously stored media bytes by key, or undefined if not found. */
  get(key: string): Promise<Uint8Array | undefined>;
}

export interface AudioTrack {
  readonly lineId: string;
  /** The `MediaSink` key the bytes were stored under — never a filesystem path (`docs/SPEC.md` §7.3). */
  readonly mediaKey: string;
  readonly durationSeconds: number;
}

export interface VoiceProvider {
  readonly id: string;
  voices(): Promise<VoiceDescriptor[]>;
  speak(lines: readonly NarrationLine[], choice: VoiceChoice): Promise<AudioTrack[]>;
}

export type FootageSource = "stock" | "generated" | "motion";

/**
 * One clip a real stock library offered for a scene's search term. This is
 * the whole vocabulary of a candidate: the library's own asset id, a label
 * a human can read on the decision sheet, the clip's duration, and the two
 * strings `StockFootageSchema`'s required `credit` field holds.
 *
 * **There is deliberately no media URL and no video bytes here.** Both are
 * re-derived from `assetId` at render/download time by
 * `FootageProvider.resolveMediaUrl`, because a plan is exportable and
 * shareable (`AGENTS.md`, "Secrets"): a download URL baked into one is a
 * licence-redistribution leak with legs, and it expires besides. The one
 * URL a candidate may carry is `credit.pageUrl`, the library's human-facing
 * asset page, which is checked against `FootageProvider.planUrlHosts`
 * before it is allowed anywhere near a plan.
 */
export interface StockClipCandidate {
  readonly assetId: string;
  readonly label: string;
  readonly durationSeconds: number;
  readonly credit: {
    readonly creator: string;
    readonly pageUrl: string;
  };
}

export interface StockSearchRequest {
  /** Which scene is asking. Used for diagnostics and cache keys, never sent to the library. */
  readonly beatId: string;
  readonly search: string;
  /** How many candidates the stage wants to weigh. */
  readonly count: number;
  /** The scene's length in seconds, so a provider can prefer a clip long enough to fill it. */
  readonly targetSeconds: number;
  /**
   * The output shape, derived by the stage from the plan's `format`. A
   * library that can filter by orientation is told the truth rather than
   * left to return landscape clips for a vertical video; a library with no
   * such filter ignores it and the renderer crops.
   */
  readonly orientation: "portrait" | "landscape" | "square";
}

/**
 * A `FootageConnection` is resolved from the environment only, the same
 * rule the model and voice connections follow. It is separate from
 * `ModelConnection` for the same reason: script, voice and footage are
 * three different slots a self-hoster may point at three different
 * places, so they get three sets of variables rather than sharing one.
 *
 * Always `kind: "byok"`. A stock library has no local, credential-free
 * half — it is either a key or it is nothing — so there is no second kind
 * to represent, and the footage stage falls back to its stub when no
 * connection resolves at all.
 */
export interface FootageConnection {
  readonly kind: "byok";
  /** Which library, as an id. Never defaulted: the self-hoster chooses. */
  readonly provider: "pexels" | "pixabay";
  /** Never logged and never written into a `Plan` — see `connection.ts` and the adapter that consumes this. */
  readonly apiKey: string;
  /** Optional API-root override for a proxy or self-hosted mirror. Absent means the library's own public host. */
  readonly baseURL?: string;
}

/**
 * The footage slot's real-provider interface — the same shape as
 * `ScriptProvider` and `VoiceProvider` (`docs/SPEC.md` §5.1): in, out, and
 * a media handle, with a choice never made here. `search` returns
 * candidates; the stage picks one and records why, which is the one rule
 * that makes the decision sheet possible at all.
 *
 * `resolveMediaUrl` is the counterpart of the id-only storage rule. It is
 * called by whatever fetches the bytes — never by a stage that is writing
 * a plan, and its return value must never be recorded in one.
 */
export interface FootageProvider {
  /** Which library this is, as an id — never a display name. */
  readonly id: string;
  /**
   * The only hosts a URL belonging to this provider may appear on inside
   * a plan. In practice the library's own public asset pages, never its
   * media CDN. `assertClipCarriesNoMediaUrl` (`footage/remoteStock.ts`)
   * enforces this, so a provider that returns a CDN link in an unexpected
   * field fails the stage instead of shipping a re-hostable URL.
   */
  readonly planUrlHosts: readonly string[];
  search(request: StockSearchRequest, signal?: AbortSignal): Promise<StockClipCandidate[]>;
  /** Re-resolves a stored asset id to a media URL at render/download time. Never recorded in a plan. */
  resolveMediaUrl(assetId: string, signal?: AbortSignal): Promise<string>;
}

export interface BeatContext {
  readonly beatId: string;
  readonly narration: string;
  readonly onScreen: string;
  readonly search: string;
  readonly style?: Record<string, unknown>;
  readonly format: {
    readonly width: number;
    readonly height: number;
    readonly fps: number;
  };
  readonly targetSeconds: number;
}

export interface CostEstimate {
  readonly kind: "free" | "tokens" | "per-second" | "per-clip";
  readonly amount?: number;
  readonly currency?: string;
  readonly localRenderSeconds?: number;
  readonly requiresConfirmation: boolean;
  readonly basis: string;
}

export interface FootageCapabilities {
  readonly source: FootageSource;
  readonly maxSeconds?: number;
  readonly aspectRatios: readonly string[];
  readonly producesAudio: boolean;
  readonly deterministicOutput: boolean;
  readonly attribution?: {
    readonly required: boolean;
    readonly display: string;
  };
}

export interface Candidate<S extends FootageSource = FootageSource, C = unknown> {
  readonly id: string;
  readonly label: string;
  readonly source: S;
  readonly data: C;
}

export interface MaterialiseIO {
  readonly media: MediaSink;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number, note: string) => void;
}

/**
 * The unified footage adapter interface all three footage sources
 * (stock, AI-generated video, motion graphics as code) implement.
 *
 * Rules:
 * - A provider returns candidates, never a final choice.
 * - Every provider declares its capabilities.
 * - No provider touches the database, the queue or the filesystem directly.
 */
export interface FootageAdapter<S extends FootageSource = FootageSource, C = unknown, D = FootageClip> {
  readonly id: string;
  readonly source: S;
  capabilities(): Promise<FootageCapabilities>;
  propose(beat: BeatContext, count: number, signal?: AbortSignal): Promise<Candidate<S, C>[]>;
  estimate(candidate: Candidate<S, C>): CostEstimate;
  materialise(candidate: Candidate<S, C>, io: MaterialiseIO): Promise<D>;
}

export type { FootageClip, GeneratedFootage, MotionFootage, StockFootage };

