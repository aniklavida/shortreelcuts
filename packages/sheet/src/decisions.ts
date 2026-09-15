/**
 * The bridge between a `Plan` and what the sheet renders: `buildDecisionGroups`
 * turns a plan (plus the candidates the stages that produced it considered)
 * into the groups and rows Screen 2 shows.
 *
 * `docs/STRUCTURE.md` places this file inside `packages/plan` once the real
 * stages exist (`decisions.ts`, "the bridge between the pipeline and the
 * interface"). It lives here, in the sheet package, while the stages
 * themselves are the stubs that also live here — moving it later is a file
 * move, not a rewrite, because nothing here reaches into `@shortreelcuts/plan`
 * beyond what `ownerOf`/`ownerOf`-shaped reasoning already exposes.
 *
 * The one rule every row here follows, because `docs/SPEC.md` §17 makes
 * it an acceptance criterion: **every row states what was chosen in plain
 * language, the one-line reason the stage recorded, and — only when it is genuinely
 * an override rather than a fact about v1 — the smallest control that
 * changes it.** A row with no `control` is not a bug: `format.*` and the
 * word-timing row are real plan fields with nothing to override yet (see
 * the reasons attached to each).
 */
import { ownerOf, type FootageClip, type Plan, type Stage } from "@shortreelcuts/plan";
import { STUB_VOICES, type DecisionCandidate } from "@shortreelcuts/stages";

/**
 * Four kinds, not five: a "select" backed by `candidates` (see
 * `DecisionRow.candidates`) is rendered as the clickable strip Screen 2
 * sketches in `docs/SPEC.md` §8 — the other candidates it did not pick —
 * while a "select" with none (`captions.style`, say, which nothing
 * rejected) is a plain dropdown. The row decides which by whether it has candidates, not by a
 * second control kind that would just duplicate that information.
 */
export type OverrideControl =
  | { readonly kind: "select"; readonly planPath: string; readonly options: readonly { value: string; label: string }[] }
  | { readonly kind: "text"; readonly planPath: string }
  | { readonly kind: "slider"; readonly planPath: string; readonly min: number; readonly max: number; readonly step: number }
  | { readonly kind: "toggle"; readonly planPath: string };

export interface DecisionRow {
  readonly id: string;
  /** Every plan leaf path this row represents — so "every field appears somewhere" is checkable by walking these. */
  readonly planPaths: readonly string[];
  readonly ownerStage: Stage | null;
  readonly label: string;
  readonly chosen: string;
  readonly reason: string;
  readonly candidates?: readonly DecisionCandidate[] | undefined;
  /** Absent means read-only: a real plan field with nothing to override yet, and the reason says why. */
  readonly control?: OverrideControl | undefined;
}

export interface DecisionGroup {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly rows: readonly DecisionRow[];
}

export interface CandidateLookup {
  (rowId: string): readonly DecisionCandidate[] | undefined;
}

const CAPTION_STYLE_OPTIONS = [
  { value: "bold-white-outline", label: "Bold white, dark outline" },
  { value: "minimal-white", label: "Minimal white, no outline" },
  { value: "yellow-highlight", label: "Yellow, highlighted background" },
] as const;

const CAPTION_POSITION_OPTIONS = [
  { value: "upper-third", label: "Upper third" },
  { value: "center", label: "Centered" },
  { value: "lower-third", label: "Lower third" },
] as const;

function voiceLabel(voiceId: string): string {
  return STUB_VOICES.find((v) => v.id === voiceId)?.label ?? voiceId;
}

function scriptGroup(plan: Plan, candidatesFor: CandidateLookup): DecisionGroup {
  const rows: DecisionRow[] = [
    {
      id: "brief",
      planPaths: ["seed", "brief.prompt", "brief.targetSeconds", "brief.tone"],
      ownerStage: ownerOf("brief.prompt"),
      label: "Starting prompt",
      chosen: `"${plan.brief.prompt}" · about ${Math.round(plan.brief.targetSeconds)}s · ${plan.brief.tone}`,
      reason: "what you typed on the first screen — change it there to start a new video, not here",
      // No control here: the prompt is Screen 1's job. It is still shown, because every plan field
      // appears somewhere — Screen 3's plan editor is where it can be changed directly if needed.
    },
    {
      id: "script.hook",
      planPaths: ["script.hook"],
      ownerStage: ownerOf("script.hook"),
      label: "Opening hook",
      chosen: plan.script.hook,
      reason: plan.script.reason,
      candidates: candidatesFor("script.hook"),
      control: { kind: "select", planPath: "script.hook", options: (candidatesFor("script.hook") ?? []).map((c) => ({ value: c.label, label: c.label })) },
    },
  ];

  plan.script.beats.forEach((beat, i) => {
    rows.push({
      id: `script.beats.${i}.narration`,
      // `.id` is structural (which beat this is), not itself a decision with its own control —
      // it rides along with the row that represents this beat so it still appears on the sheet.
      planPaths: [`script.beats.${i}.narration`, `script.beats.${i}.id`],
      ownerStage: ownerOf(`script.beats.${i}.narration`),
      label: `What beat ${i + 1} says`,
      chosen: beat.narration,
      reason: plan.script.reason,
      control: { kind: "text", planPath: `script.beats.${i}.narration` },
    });
  });

  return {
    id: "script",
    title: "Script",
    summary: `${plan.script.beats.length} beats · ${Math.round(plan.brief.targetSeconds)}s · ${plan.brief.tone}`,
    rows,
  };
}

function voiceGroup(plan: Plan, candidatesFor: CandidateLookup): DecisionGroup {
  const candidates = candidatesFor("voice.voiceId") ?? STUB_VOICES.map((v) => ({ id: v.id, label: v.label, chosen: v.id === plan.voice.voiceId }));
  return {
    id: "voice",
    title: "Voice",
    summary: `${voiceLabel(plan.voice.voiceId)}, ${plan.voice.rate.toFixed(1)}×`,
    rows: [
      {
        id: "voice.voiceId",
        planPaths: ["voice.voiceId", "voice.provider"],
        ownerStage: ownerOf("voice.voiceId"),
        label: "Voice",
        chosen: voiceLabel(plan.voice.voiceId),
        reason: plan.voice.reason,
        candidates,
        control: { kind: "select", planPath: "voice.voiceId", options: STUB_VOICES.map((v) => ({ value: v.id, label: v.label })) },
      },
      {
        id: "voice.rate",
        planPaths: ["voice.rate"],
        ownerStage: ownerOf("voice.rate"),
        label: "Speaking rate",
        chosen: `${plan.voice.rate.toFixed(2)}×`,
        reason: "1.0× keeps pace with the calm, unhurried default — slower or faster is always a direct override",
        control: { kind: "slider", planPath: "voice.rate", min: 0.75, max: 1.25, step: 0.05 },
      },
    ],
  };
}

/**
 * What a footage row shows for "chosen", given the clip currently on the
 * plan. Only "stock" has a real UI today (a candidate strip, or the
 * asset id itself) — showing a per-beat, three-way source picker for
 * "generated" and "motion" is not built yet. This still states plainly
 * what the plan holds rather than guessing at it.
 */
function footageChosenLabel(clip: FootageClip, candidates: readonly DecisionCandidate[] | undefined): string {
  if (clip.source === "stock") {
    return (candidates ?? []).find((c) => c.chosen)?.label ?? clip.assetId;
  }
  if (clip.source === "generated") {
    return `generated clip: "${clip.prompt}"`;
  }
  return `animated scene (${clip.scene.kind === "template" ? clip.scene.template : "hand-written code"})`;
}

function footageGroup(plan: Plan, candidatesFor: CandidateLookup): DecisionGroup {
  const rows: DecisionRow[] = [];
  plan.script.beats.forEach((beat, i) => {
    const clip = plan.footage[beat.id];
    if (!clip) return;
    const candidates = candidatesFor(`footage.${beat.id}`);
    rows.push({
      id: `footage.${beat.id}`,
      planPaths: [
        `footage.${beat.id}.source`,
        `footage.${beat.id}.assetId`,
        `footage.${beat.id}.provider`,
        `footage.${beat.id}.in`,
        `footage.${beat.id}.out`,
        `footage.${beat.id}.credit`,
        `footage.${beat.id}.prompt`,
        `footage.${beat.id}.model`,
        `footage.${beat.id}.seconds`,
        `footage.${beat.id}.providerSeed`,
        `footage.${beat.id}.output`,
        `footage.${beat.id}.quotedCost`,
        `footage.${beat.id}.runtime`,
        `footage.${beat.id}.scene`,
        `footage.${beat.id}.captionsInScene`,
      ],
      ownerStage: ownerOf(`footage.${beat.id}.assetId`),
      label: `Clip for beat ${i + 1} — "${beat.search}"`,
      chosen: footageChosenLabel(clip, candidates),
      reason: clip.reason,
      candidates,
      control:
        candidates && clip.source === "stock"
          ? { kind: "select", planPath: `footage.${beat.id}.assetId`, options: candidates.map((c) => ({ value: c.id, label: c.label })) }
          : undefined,
    });
    rows.push({
      id: `script.beats.${i}.search`,
      planPaths: [`script.beats.${i}.search`],
      ownerStage: ownerOf(`script.beats.${i}.search`),
      label: `Search term for beat ${i + 1}`,
      chosen: beat.search,
      reason: "what the footage lookup for this beat is based on",
      control: { kind: "text", planPath: `script.beats.${i}.search` },
    });
    rows.push({
      id: `script.beats.${i}.onScreen`,
      planPaths: [`script.beats.${i}.onScreen`],
      ownerStage: ownerOf(`script.beats.${i}.onScreen`),
      label: `On-screen text for beat ${i + 1}`,
      chosen: beat.onScreen,
      reason: "burned in alongside the captions — a compose-time overlay, independent of the spoken narration",
      control: { kind: "text", planPath: `script.beats.${i}.onScreen` },
    });
  });

  return {
    id: "footage",
    title: "Footage",
    summary: `${plan.script.beats.length} clips · vertical`,
    rows,
  };
}

function captionsGroup(plan: Plan): DecisionGroup {
  const totalWords = Object.values(plan.align.words).reduce((sum, words) => sum + words.length, 0);
  return {
    id: "captions",
    title: "Captions",
    summary: `${plan.captions.wordsPerCue} words at a time · ${plan.captions.position.replace("-", " ")}`,
    rows: [
      {
        id: "captions.style",
        planPaths: ["captions.style"],
        ownerStage: ownerOf("captions.style"),
        label: "Style",
        chosen: CAPTION_STYLE_OPTIONS.find((o) => o.value === plan.captions.style)?.label ?? plan.captions.style,
        reason: plan.captions.reason,
        control: { kind: "select", planPath: "captions.style", options: CAPTION_STYLE_OPTIONS.map((o) => ({ ...o })) },
      },
      {
        id: "captions.position",
        planPaths: ["captions.position"],
        ownerStage: ownerOf("captions.position"),
        label: "Position",
        chosen: CAPTION_POSITION_OPTIONS.find((o) => o.value === plan.captions.position)?.label ?? plan.captions.position,
        reason: plan.captions.reason,
        control: { kind: "select", planPath: "captions.position", options: CAPTION_POSITION_OPTIONS.map((o) => ({ ...o })) },
      },
      {
        id: "captions.wordsPerCue",
        planPaths: ["captions.wordsPerCue"],
        ownerStage: ownerOf("captions.wordsPerCue"),
        label: "Words per caption",
        chosen: `${plan.captions.wordsPerCue}`,
        reason: plan.captions.reason,
        control: { kind: "slider", planPath: "captions.wordsPerCue", min: 1, max: 6, step: 1 },
      },
      {
        id: "align.words",
        planPaths: ["align.provider", "align.words"],
        ownerStage: ownerOf("align.provider"),
        label: "Word timing",
        chosen: `${totalWords} words timed, synced to the voiceover`,
        reason: plan.align.reason,
        // No control: timing is derived from the voice and script, never set directly.
      },
    ],
  };
}

function musicGroup(plan: Plan): DecisionGroup {
  return {
    id: "music",
    title: "Music",
    summary: plan.music.enabled ? `background bed at ${Math.round(plan.music.volume * 100)}%` : "none",
    rows: [
      {
        id: "music.enabled",
        planPaths: ["music.enabled", "music.provider", "music.trackId"],
        ownerStage: ownerOf("music.enabled"),
        label: "Background music",
        chosen: plan.music.enabled ? "On" : "Off",
        reason: plan.music.reason,
        control: { kind: "toggle", planPath: "music.enabled" },
      },
      {
        id: "music.volume",
        planPaths: ["music.volume"],
        ownerStage: ownerOf("music.volume"),
        label: "Music volume",
        chosen: `${Math.round(plan.music.volume * 100)}%`,
        reason: "kept low enough to sit under the voiceover, not compete with it",
        control: { kind: "slider", planPath: "music.volume", min: 0, max: 1, step: 0.05 },
      },
    ],
  };
}

function formatGroup(plan: Plan): DecisionGroup {
  return {
    id: "format",
    title: "Format",
    summary: `${plan.format.width}×${plan.format.height} · ${plan.format.fps}fps · ${plan.format.container.toUpperCase()}`,
    rows: [
      {
        id: "format",
        planPaths: ["format.width", "format.height", "format.fps", "format.container"],
        ownerStage: ownerOf("format.width"),
        label: "Output shape",
        chosen: `${plan.format.width} × ${plan.format.height}, ${plan.format.fps}fps, ${plan.format.container.toUpperCase()}`,
        reason: "every short-form platform accepts this shape with one encode — other aspect ratios are a planned override, not a v1 promise",
        // No control at v1 — the schema fixes this shape (see @shortreelcuts/plan's FormatSchema).
      },
    ],
  };
}

/** Builds every group Screen 2 renders, in the reading order `docs/SPEC.md` §8 sketches: the script first, then what is made from it, the format last. */
export function buildDecisionGroups(plan: Plan, candidatesFor: CandidateLookup): readonly DecisionGroup[] {
  return [
    scriptGroup(plan, candidatesFor),
    voiceGroup(plan, candidatesFor),
    footageGroup(plan, candidatesFor),
    captionsGroup(plan),
    musicGroup(plan),
    formatGroup(plan),
  ];
}
