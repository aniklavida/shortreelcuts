/**
 * The plan schema.
 *
 * A ShortReelCuts video is a plan, rendered. This document holds every
 * decision that produces a video — the script, the shot list, the voice,
 * the caption style, the format, the seed — and the renderer (not built by
 * this package) is meant to be a pure function of it.
 *
 * No renderer exists yet. This file only describes the shape of the
 * decisions and validates them; it does not produce or consume a video.
 *
 * `planVersion` is versioned from this, the first commit. See `migrate.ts`
 * for how a stored plan is expected to move forward across versions.
 */
import { z } from "zod";

/**
 * The six pipeline stages, in pipeline order. See `graph.ts` for how they
 * depend on each other.
 *
 * `frames` was added at `planVersion` 2: it turns each beat's footage
 * decision (a trimmed stock clip, a generated clip, or a motion-graphics
 * scene) into one normalised clip, so `compose` keeps working on files
 * regardless of which of the three produced them. No runner for `frames`
 * exists yet — it is defined here and in the graph below so the schema and
 * the invalidation rules are right from the start, not implemented end to
 * end. Only `compose` has a real implementation anywhere in this repository.
 */
export const STAGES = ["script", "voice", "footage", "align", "frames", "compose"] as const;

export type Stage = (typeof STAGES)[number];

export const CURRENT_PLAN_VERSION = 2 as const;

/** Every decision-bearing node explains itself. Not optional, not nullable. */
const reason = z.string().min(1, "a decision must record why it was made");

export const BriefSchema = z
  .object({
    prompt: z.string().min(1),
    targetSeconds: z.number().positive(),
    tone: z.string().min(1),
  })
  .strict();

export type Brief = z.infer<typeof BriefSchema>;

export const BeatSchema = z
  .object({
    id: z.string().min(1),
    /** What is spoken for this beat. Feeds the voice stage. */
    narration: z.string().min(1),
    /** Text overlaid on screen for this beat, independent of the spoken narration. */
    onScreen: z.string().min(1),
    /** The footage search term for this beat. Feeds the footage stage. */
    search: z.string().min(1),
  })
  .strict();

export type Beat = z.infer<typeof BeatSchema>;

export const ScriptSchema = z
  .object({
    hook: z.string().min(1),
    beats: z.array(BeatSchema).min(1),
    reason,
  })
  .strict();

export type ScriptPlan = z.infer<typeof ScriptSchema>;

export const VoiceSchema = z
  .object({
    provider: z.string().min(1),
    voiceId: z.string().min(1),
    rate: z.number().positive(),
    reason,
  })
  .strict();

export type VoicePlan = z.infer<typeof VoiceSchema>;

/**
 * `footage.<beatId>` at `planVersion` 2: a discriminated union across the
 * three footage sources `docs/SPEC.md` §11 names — stock, generated video,
 * and motion graphics written as code. Every beat picks exactly one; a
 * video can mix all three across its beats.
 */
const CreditSchema = z
  .object({
    creator: z.string().min(1),
    pageUrl: z.string().url(),
  })
  .strict();

export const StockFootageSchema = z
  .object({
    source: z.literal("stock"),
    /**
     * The library this clip came from. Kept as an open string rather than an
     * enum of the two providers `docs/SPEC.md` §11 names (Pexels, Pixabay):
     * neither adapter is built yet, and a migrated `planVersion` 1 plan's
     * stub provider id ("stub", or a test fixture's own name) must still
     * validate. The enum can tighten once a real adapter is the only thing
     * that ever writes this field.
     */
    provider: z.string().min(1),
    /** Never a download URL — see `docs/SPEC.md` §16: links expire, an id does not. */
    assetId: z.string().min(1),
    in: z.number().nonnegative(),
    out: z.number().positive(),
    credit: CreditSchema,
    reason,
  })
  .strict()
  .refine((clip) => clip.out > clip.in, {
    message: "out must be after in",
    path: ["out"],
  });

export type StockFootage = z.infer<typeof StockFootageSchema>;

export const GeneratedFootageSchema = z
  .object({
    source: z.literal("generated"),
    /** Which generation adapter — an id, not a display name. */
    provider: z.string().min(1),
    model: z.string().min(1),
    /** What was asked for. An override target, shown on the sheet. */
    prompt: z.string().min(1),
    seconds: z.number().positive(),
    /** Recorded if the provider accepts one; never relied on for determinism — see `docs/SPEC.md` §17. */
    providerSeed: z.number().int().optional(),
    /** Filled once the job completes. This is what makes re-render free: the file is stored, never re-requested. */
    output: z
      .object({
        mediaKey: z.string().regex(/^sha256:/),
        jobId: z.string().min(1),
      })
      .strict()
      .optional(),
    quotedCost: z
      .object({
        amount: z.number().nonnegative(),
        currency: z.string().min(1),
        basis: z.string().min(1),
      })
      .strict(),
    reason,
  })
  .strict();

export type GeneratedFootage = z.infer<typeof GeneratedFootageSchema>;

const MotionSceneSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("template"),
      template: z.string().min(1),
      params: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("code"),
      html: z.string(),
      css: z.string(),
      js: z.string(),
    })
    .strict(),
]);

export type MotionScene = z.infer<typeof MotionSceneSchema>;

export const MotionFootageSchema = z
  .object({
    source: z.literal("motion"),
    /** The runtime API version the code/template targets — see `docs/SPEC.md` §11. */
    runtime: z.literal("srcuts-motion@1"),
    scene: MotionSceneSchema,
    /** True suppresses compose's burned-in captions for this beat, so the scene's own text is not doubled. */
    captionsInScene: z.boolean(),
    /** Which connected model wrote this scene — shown on the sheet as the row's "why". */
    model: z.string().min(1),
    reason,
  })
  .strict();

export type MotionFootage = z.infer<typeof MotionFootageSchema>;

export const FootageClipSchema = z.discriminatedUnion("source", [
  StockFootageSchema,
  GeneratedFootageSchema,
  MotionFootageSchema,
]);

export type FootageClip = z.infer<typeof FootageClipSchema>;

/** Keyed by beat id — one chosen clip per beat. */
export const FootageSchema = z.record(z.string().min(1), FootageClipSchema);

export type FootagePlan = z.infer<typeof FootageSchema>;

export const AlignedWordSchema = z
  .object({
    word: z.string().min(1),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
  })
  .strict()
  .refine((w) => w.endSeconds > w.startSeconds, {
    message: "endSeconds must be after startSeconds",
    path: ["endSeconds"],
  });

export type AlignedWord = z.infer<typeof AlignedWordSchema>;

export const AlignSchema = z
  .object({
    provider: z.string().min(1),
    /** Keyed by beat id — word-level timings for that beat's narration. */
    words: z.record(z.string().min(1), z.array(AlignedWordSchema)),
    reason,
  })
  .strict();

export type AlignPlan = z.infer<typeof AlignSchema>;

export const CaptionsSchema = z
  .object({
    style: z.string().min(1),
    position: z.enum(["upper-third", "center", "lower-third"]),
    wordsPerCue: z.number().int().positive(),
    reason,
  })
  .strict();

export type CaptionsPlan = z.infer<typeof CaptionsSchema>;

export const MusicSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.string().min(1).optional(),
    trackId: z.string().min(1).optional(),
    volume: z.number().min(0).max(1),
    reason,
  })
  .strict()
  .refine((m) => !m.enabled || (m.provider !== undefined && m.trackId !== undefined), {
    message: "provider and trackId are required when music is enabled",
    path: ["provider"],
  });

export type MusicPlan = z.infer<typeof MusicSchema>;

/**
 * The output shapes a plan may choose from, keyed by aspect ratio.
 *
 * v1 shipped exactly one — 9:16 vertical, `docs/SPEC.md` §15. 16:9 and 1:1
 * were added as selectable ratios later; the dimensions below are the
 * canonical, even-pixel ones this project renders to, and the schema only
 * accepts these exact pairs so the same ratio always means the same file
 * shape.
 *
 * The plan stores concrete `width`/`height`, not the ratio token, because
 * the renderer is a pure function of the plan and `ffmpeg` consumes pixels:
 * an override changes the pixels it will actually encode, and the ratio is
 * derived from them (`aspectRatioOf`) for display and for choosing between
 * presets.
 */
export const FORMAT_PRESETS = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
} as const satisfies Record<string, { width: number; height: number }>;

export type AspectRatio = keyof typeof FORMAT_PRESETS;

/** The ratio v1 shipped, and what a plan that specifies no format keeps getting. */
export const DEFAULT_ASPECT_RATIO: AspectRatio = "9:16";

const ASPECT_RATIO_BY_SHAPE = new Map<string, AspectRatio>(
  Object.entries(FORMAT_PRESETS).map(([ratio, dims]) => [`${dims.width}x${dims.height}`, ratio as AspectRatio]),
);

/** The supported aspect ratio a format's dimensions correspond to, or `undefined` for a shape this project does not render. */
export function aspectRatioOf(format: Pick<FormatPlan, "width" | "height">): AspectRatio | undefined {
  return ASPECT_RATIO_BY_SHAPE.get(`${format.width}x${format.height}`);
}

/**
 * `format` describes the pixels `compose` should emit. `width`/`height` are
 * validated against `FORMAT_PRESETS` rather than fixed, so a plan can choose
 * the shape but never an arbitrary one the rest of the pipeline has not been
 * given crop logic for.
 */
export const FormatSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.literal(30),
    container: z.literal("mp4"),
  })
  .strict()
  .superRefine((format, ctx) => {
    if (aspectRatioOf(format) !== undefined) return;
    const supported = Object.entries(FORMAT_PRESETS)
      .map(([ratio, dims]) => `${dims.width}x${dims.height} (${ratio})`)
      .join(", ");
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `unsupported output shape ${format.width}x${format.height}; supported shapes are ${supported}`,
      path: ["width"],
    });
  });

export type FormatPlan = z.infer<typeof FormatSchema>;

/**
 * What produced the `frames` stage's output — not a decision. `ownerOf`
 * (`graph.ts`) maps every field here to `null`, the same as a `reason`
 * string: it never triggers a re-run, but it explains a pixel difference
 * between two machines re-rendering the same plan (`docs/SPEC.md` §17 — a
 * fresh motion render is byte-identical only on the same pinned browser,
 * fonts and `ffmpeg`). Optional because nothing populates it yet — the
 * `frames` stage itself has no runner built yet (§6).
 */
export const RenderMetadataSchema = z
  .object({
    chromium: z.string().min(1),
    runtime: z.string().min(1),
    ffmpeg: z.string().min(1),
  })
  .strict();

export type RenderMetadata = z.infer<typeof RenderMetadataSchema>;

export const PlanSchema = z
  .object({
    planVersion: z.literal(CURRENT_PLAN_VERSION),
    /** So the same plan renders the same video twice. */
    seed: z.number().int(),
    brief: BriefSchema,
    script: ScriptSchema,
    voice: VoiceSchema,
    footage: FootageSchema,
    align: AlignSchema,
    captions: CaptionsSchema,
    music: MusicSchema,
    format: FormatSchema,
    render: RenderMetadataSchema.optional(),
  })
  .strict();

export type Plan = z.infer<typeof PlanSchema>;

/** Parses and validates a plan document. Throws a ZodError on an invalid plan. */
export function parsePlan(value: unknown): Plan {
  return PlanSchema.parse(value);
}
