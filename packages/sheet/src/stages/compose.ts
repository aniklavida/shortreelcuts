/**
 * The compose stage — the one real stage.
 *
 * Everything upstream of this file is a stand-in (`script.ts`, `voice.ts`,
 * `footage.ts`, `align.ts`, `media.ts`). This file is not: it synthesizes
 * stand-in media for the stages that don't exist yet, then calls
 * `@shortreelcuts/render`'s real `render()`, which spawns real `ffmpeg`
 * and produces a real, playable MP4. `packages/render` genuinely stands
 * in as this stage rather than being mocked for it.
 *
 * `captions`/`music`/`format` are owned by `compose` in
 * `@shortreelcuts/plan`'s graph (`graph.ts`'s `NAMESPACE_RULES`) — they
 * are rendering decisions, not upstream ones — so this is also where
 * their v1 defaults are chosen, once, the first time a plan is composed.
 */
import { join } from "node:path";
import type { CaptionsPlan, MusicPlan, FormatPlan, Plan } from "@shortreelcuts/plan";
import { render } from "@shortreelcuts/render";
import { synthesizeStubMedia } from "./media.js";
import type { ComposeRunInput, ComposeRunResult } from "./types.js";

const DEFAULT_CAPTIONS: CaptionsPlan = {
  style: "bold-white-outline",
  position: "lower-third",
  wordsPerCue: 3,
  reason: "three words at a time stays readable at 1080px wide on a phone screen",
};

const DEFAULT_MUSIC: MusicPlan = {
  enabled: false,
  volume: 0,
  reason: "no bed selected — nothing in the brief asked for one, and the voice can carry the video alone",
};

const DEFAULT_FORMAT: FormatPlan = { width: 1080, height: 1920, fps: 30, container: "mp4" };

/** Fills in compose-owned fields with their v1 defaults, only where a plan doesn't already have them decided. */
export function withComposeDefaults(plan: Plan): Plan {
  return {
    ...plan,
    captions: plan.captions ?? DEFAULT_CAPTIONS,
    music: plan.music ?? DEFAULT_MUSIC,
    format: plan.format ?? DEFAULT_FORMAT,
  };
}

export async function runCompose(input: ComposeRunInput): Promise<ComposeRunResult> {
  const plan = withComposeDefaults(input.plan);
  const media = await synthesizeStubMedia(plan, join(input.workDir, "media"));

  const outputPath = join(input.workDir, "output.mp4");
  const video = await render(plan, media, { outputPath });

  return {
    patch: { captions: plan.captions, music: plan.music, format: plan.format },
    candidates: {},
    video,
  };
}
