/**
 * Runners for the dev preview: the real script/voice/footage/align stubs
 * this package ships, paired with a fake `compose` — real `ffmpeg` cannot
 * run inside a browser tab, so the actual `render()` from
 * `@shortreelcuts/render` is proven separately, against Node, in
 * `session.e2e.test.ts`. This file exists only so the preview doesn't
 * import `vitest`'s mocking helpers the way `testing/fakeRunners.ts`
 * (test-only) does.
 */
import { runAlign, runFootage, runScript, runVoice, withComposeDefaults } from "@shortreelcuts/stages";
import type { ComposeRunResult, StageRunners } from "@shortreelcuts/stages";

function fakeVideo(path: string) {
  return { path, captionsPath: `${path}.srt`, width: 1080, height: 1920, fps: 30, durationSeconds: 12 };
}

export function makePreviewRunners(): StageRunners {
  return {
    script: runScript,
    voice: runVoice,
    footage: runFootage,
    align: runAlign,
    compose: async (input): Promise<ComposeRunResult> => {
      // A little artificial delay so the progress strip is visible instead of instant.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const plan = withComposeDefaults(input.plan);
      return {
        patch: { captions: plan.captions, music: plan.music, format: plan.format },
        candidates: {},
        video: fakeVideo(`${input.workDir}/output.mp4`),
      };
    },
  };
}
