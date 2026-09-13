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

/** The five pipeline stages, in pipeline order. See `graph.ts` for how they depend on each other. */
export const STAGES = ["script", "voice", "footage", "align", "compose"] as const;

export type Stage = (typeof STAGES)[number];

export const CURRENT_PLAN_VERSION = 1 as const;

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

export const FootageClipSchema = z
  .object({
    provider: z.string().min(1),
    assetId: z.string().min(1),
    in: z.number().nonnegative(),
    out: z.number().positive(),
    reason,
  })
  .strict()
  .refine((clip) => clip.out > clip.in, {
    message: "out must be after in",
    path: ["out"],
  });

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

/** v1 ships exactly this output shape. See SPEC.md §15. */
export const FormatSchema = z
  .object({
    width: z.literal(1080),
    height: z.literal(1920),
    fps: z.literal(30),
    container: z.literal("mp4"),
  })
  .strict();

export type FormatPlan = z.infer<typeof FormatSchema>;

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
  })
  .strict();

export type Plan = z.infer<typeof PlanSchema>;

/** Parses and validates a plan document. Throws a ZodError on an invalid plan. */
export function parsePlan(value: unknown): Plan {
  return PlanSchema.parse(value);
}
