/**
 * Test support only: real script/voice/footage/align stubs (the actual
 * ones this package ships), paired with a fast fake `compose` that skips
 * `ffmpeg` entirely. Used by both `session.test.ts` and the component
 * tests, so "script and footage were never touched" assertions exercise
 * the real stage logic rather than a second, parallel fake of it.
 *
 * `session.e2e.test.ts` is the one place `compose` is the real thing.
 */
import type { ComposeRunResult, FramesRunResult, StageRunners } from "@shortreelcuts/stages";
import { runAlign, runFootage, runFrames, runScript, runVoice, withComposeDefaults } from "@shortreelcuts/stages";
import { vi, type Mock } from "vitest";

function fakeVideo(path: string) {
  return { path, captionsPath: `${path}.srt`, width: 1080, height: 1920, fps: 30, durationSeconds: 12 };
}

export type FakeStageRunners = { [K in keyof StageRunners]: Mock<StageRunners[K]> };

export function makeFakeRunners(): FakeStageRunners {
  const compose = vi.fn(async (input: Parameters<StageRunners["compose"]>[0]): Promise<ComposeRunResult> => {
    const plan = withComposeDefaults(input.plan);
    return {
      patch: { captions: plan.captions, music: plan.music, format: plan.format },
      candidates: {},
      video: fakeVideo(`${input.workDir}/output.mp4`),
    };
  });

  const frames = vi.fn(async (input: Parameters<StageRunners["frames"]>[0]): Promise<FramesRunResult> => {
    return {
      patch: {
        render: {
          chromium: "chrome-headless-shell@153.0.8010.12",
          runtime: "srcuts-motion@1",
          ffmpeg: "bitexact",
        },
      },
      candidates: {},
      clips: Object.fromEntries(
        input.plan.script.beats.map((b) => [b.id, `${input.workDir}/frames/${b.id}.mp4`]),
      ),
      renderedBeats: input.plan.script.beats.map((b) => b.id),
    };
  });

  return {
    script: vi.fn(runScript),
    voice: vi.fn(runVoice),
    footage: vi.fn(runFootage),
    align: vi.fn(runAlign),
    frames,
    compose,
  };
}

