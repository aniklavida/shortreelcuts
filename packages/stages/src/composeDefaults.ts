/**
 * `captions`/`music`/`format` v1 defaults — split out from `compose.ts`
 * because this half is pure (no `node:*`, no `ffmpeg`) and the dev
 * preview's fake compose (`testing/fakeRunners.ts`) needs exactly this
 * half without pulling `@shortreelcuts/render` and `execa` into a
 * browser bundle that will never actually run them.
 */
import type { CaptionsPlan, FormatPlan, MusicPlan, Plan } from "@shortreelcuts/plan";

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
