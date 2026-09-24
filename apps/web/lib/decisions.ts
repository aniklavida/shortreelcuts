/**
 * Extracts stage-by-stage decisions from partial or complete plan documents
 * as stages finish running.
 *
 * This turns progress into the decision sheet itself rather than a spinner:
 * as each stage finishes, its choices and their reasons land immediately on
 * the status payload so the client can display them incrementally.
 */
import { STAGES, type Stage } from "@shortreelcuts/plan";
import { STUB_VOICES, type DecisionCandidate } from "@shortreelcuts/stages";

export interface DecisionItem {
  readonly id: string;
  readonly stage: Stage;
  readonly label: string;
  readonly chosen: string;
  readonly reason: string;
  readonly candidates?: readonly DecisionCandidate[] | undefined;
}

export interface StageProgress {
  readonly stage: Stage;
  readonly status: "pending" | "running" | "done";
  readonly decisions: readonly DecisionItem[];
}

function voiceLabel(voiceId: string): string {
  return STUB_VOICES.find((v) => v.id === voiceId)?.label ?? voiceId;
}

function extractScriptDecisions(plan: any, candidatesFor: (path: string) => readonly DecisionCandidate[] | undefined): DecisionItem[] {
  if (!plan?.script) return [];
  const items: DecisionItem[] = [
    {
      id: "script.hook",
      stage: "script",
      label: "Opening hook",
      chosen: plan.script.hook,
      reason: plan.script.reason,
      candidates: candidatesFor("script.hook"),
    },
  ];

  if (Array.isArray(plan.script.beats)) {
    plan.script.beats.forEach((beat: any, i: number) => {
      items.push({
        id: `script.beats.${i}.narration`,
        stage: "script",
        label: `What beat ${i + 1} says`,
        chosen: beat.narration,
        reason: plan.script.reason,
      });
      items.push({
        id: `script.beats.${i}.search`,
        stage: "script",
        label: `Search term for beat ${i + 1}`,
        chosen: beat.search,
        reason: "what the footage lookup for this beat is based on",
      });
      items.push({
        id: `script.beats.${i}.onScreen`,
        stage: "script",
        label: `On-screen text for beat ${i + 1}`,
        chosen: beat.onScreen,
        reason: "burned in alongside the captions — a compose-time overlay, independent of the spoken narration",
      });
    });
  }

  return items;
}

function extractVoiceDecisions(plan: any, candidatesFor: (path: string) => readonly DecisionCandidate[] | undefined): DecisionItem[] {
  if (!plan?.voice) return [];
  const candidates = candidatesFor("voice.voiceId") ?? STUB_VOICES.map((v) => ({ id: v.id, label: v.label, chosen: v.id === plan.voice.voiceId }));
  return [
    {
      id: "voice.voiceId",
      stage: "voice",
      label: "Voice",
      chosen: voiceLabel(plan.voice.voiceId),
      reason: plan.voice.reason,
      candidates,
    },
    {
      id: "voice.rate",
      stage: "voice",
      label: "Speaking rate",
      chosen: `${Number(plan.voice.rate ?? 1).toFixed(2)}×`,
      reason: "1.0× keeps pace with the calm, unhurried default — slower or faster is always a direct override",
    },
  ];
}

function extractFootageDecisions(plan: any, candidatesFor: (path: string) => readonly DecisionCandidate[] | undefined): DecisionItem[] {
  if (!plan?.footage || !Array.isArray(plan?.script?.beats)) return [];
  const items: DecisionItem[] = [];
  plan.script.beats.forEach((beat: any, i: number) => {
    const clip = plan.footage[beat.id];
    if (!clip) return;
    const candidates = candidatesFor(`footage.${beat.id}`);
    const chosen = clip.source === "stock"
      ? (candidates ?? []).find((c: any) => c.chosen)?.label ?? clip.assetId
      : clip.source === "generated"
        ? `generated clip: "${clip.prompt}"`
        : `animated scene (${clip.scene?.kind === "template" ? clip.scene.template : "hand-written code"})`;

    items.push({
      id: `footage.${beat.id}`,
      stage: "footage",
      label: `Clip for beat ${i + 1} — "${beat.search}"`,
      chosen,
      reason: clip.reason,
      candidates,
    });
  });
  return items;
}

function extractAlignDecisions(plan: any): DecisionItem[] {
  if (!plan?.align) return [];
  const totalWords = Object.values(plan.align.words ?? {}).reduce(
    (sum: number, words: any) => sum + (Array.isArray(words) ? words.length : 0),
    0,
  );
  return [
    {
      id: "align.words",
      stage: "align",
      label: "Word timing",
      chosen: `${totalWords} words timed, synced to the voiceover`,
      reason: plan.align.reason,
    },
  ];
}

function extractFramesDecisions(plan: any): DecisionItem[] {
  if (!plan?.frames) return [];
  return [
    {
      id: "frames.sequence",
      stage: "frames",
      label: "Animation frames",
      chosen: "rendered motion frames",
      reason: plan.frames.reason ?? "generated frames for composition",
    },
  ];
}

function extractComposeDecisions(plan: any): DecisionItem[] {
  const items: DecisionItem[] = [];
  if (plan?.captions) {
    items.push(
      {
        id: "captions.style",
        stage: "compose",
        label: "Captions style",
        chosen: plan.captions.style,
        reason: plan.captions.reason,
      },
      {
        id: "captions.position",
        stage: "compose",
        label: "Captions position",
        chosen: plan.captions.position,
        reason: plan.captions.reason,
      },
      {
        id: "captions.wordsPerCue",
        stage: "compose",
        label: "Words per caption",
        chosen: `${plan.captions.wordsPerCue}`,
        reason: plan.captions.reason,
      },
    );
  }
  if (plan?.music) {
    items.push(
      {
        id: "music.enabled",
        stage: "compose",
        label: "Background music",
        chosen: plan.music.enabled ? "On" : "Off",
        reason: plan.music.reason,
      },
      {
        id: "music.volume",
        stage: "compose",
        label: "Music volume",
        chosen: `${Math.round(plan.music.volume * 100)}%`,
        reason: "kept low enough to sit under the voiceover, not compete with it",
      },
    );
  }
  if (plan?.format) {
    items.push({
      id: "format",
      stage: "compose",
      label: "Output shape",
      chosen: `${plan.format.width} × ${plan.format.height}, ${plan.format.fps}fps, ${plan.format.container.toUpperCase()}`,
      reason: "the render encodes exactly the dimensions in the plan",
    });
  }
  return items;
}

export function extractStageDecisions(
  plan: unknown,
  completedStages: readonly string[],
  candidates: unknown = {},
): Record<Stage, DecisionItem[]> {
  const candidatesMap = (candidates as Record<string, readonly DecisionCandidate[]> | null) ?? {};
  const candidatesFor = (path: string) => candidatesMap[path];

  const result: Record<Stage, DecisionItem[]> = {
    script: [],
    voice: [],
    footage: [],
    align: [],
    frames: [],
    compose: [],
  };

  const completedSet = new Set(completedStages);
  if (completedSet.has("script")) {
    result.script = extractScriptDecisions(plan, candidatesFor);
  }
  if (completedSet.has("voice")) {
    result.voice = extractVoiceDecisions(plan, candidatesFor);
  }
  if (completedSet.has("footage")) {
    result.footage = extractFootageDecisions(plan, candidatesFor);
  }
  if (completedSet.has("align")) {
    result.align = extractAlignDecisions(plan);
  }
  if (completedSet.has("frames")) {
    result.frames = extractFramesDecisions(plan);
  }
  if (completedSet.has("compose")) {
    result.compose = extractComposeDecisions(plan);
  }

  return result;
}

export function buildProgressStages(
  status: string,
  completedStages: readonly string[],
  stageDecisions: Record<Stage, readonly DecisionItem[]>,
): readonly StageProgress[] {
  const completedSet = new Set(completedStages);
  const nextStageIndex = completedStages.length;

  return STAGES.map((stage, idx) => {
    let stageStatus: "pending" | "running" | "done" = "pending";
    if (completedSet.has(stage)) {
      stageStatus = "done";
    } else if (idx === nextStageIndex && status === "running") {
      stageStatus = "running";
    }

    return {
      stage,
      status: stageStatus,
      decisions: stageDecisions[stage] ?? [],
    };
  });
}
