import type { FormatPlan, MusicPlan } from "@shortreelcuts/plan";
import { describe, expect, it } from "vitest";
import { applyCaptionsBurnIn, buildAudioGraph, buildVideoGraph, escapeFilterPath } from "./filtergraph.js";
import type { Timeline } from "./timeline.js";

const FORMAT: FormatPlan = { width: 1080, height: 1920, fps: 30, container: "mp4" };

function timelineOf(scenes: Timeline["scenes"], transitionSeconds = 0.4): Timeline {
  return {
    scenes,
    cues: [],
    transitionSeconds,
    totalDurationSeconds: scenes.at(-1) ? scenes.at(-1)!.startOffsetSeconds + scenes.at(-1)!.sceneDurationSeconds : 0,
  };
}

describe("buildVideoGraph", () => {
  it("trims, scales and crops a single scene with no crossfade", () => {
    const timeline = timelineOf([
      {
        beatId: "b1",
        footagePath: "/media/f1.mp4",
        sourceInSeconds: 0,
        sourceOutSeconds: 4,
        narrationPath: "/media/n1.wav",
        narrationDurationSeconds: 4,
        sceneDurationSeconds: 4,
        holdLastFrameSeconds: 0,
        startOffsetSeconds: 0,
      },
    ]);

    const graph = buildVideoGraph(timeline, FORMAT);

    expect(graph.inputPaths).toEqual(["/media/f1.mp4"]);
    expect(graph.outputLabel).toBe("scene0");
    expect(graph.filterLines).toHaveLength(1);
    expect(graph.filterLines[0]).toBe(
      "[0:v]trim=start=0:end=4,setpts=PTS-STARTPTS,scale=w=1080:h=1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p,setsar=1[scene0]",
    );
  });

  it("holds the last frame when the scene needs more than the footage provides", () => {
    const timeline = timelineOf([
      {
        beatId: "b1",
        footagePath: "/media/f1.mp4",
        sourceInSeconds: 1,
        sourceOutSeconds: 3,
        narrationPath: "/media/n1.wav",
        narrationDurationSeconds: 5,
        sceneDurationSeconds: 5,
        holdLastFrameSeconds: 3,
        startOffsetSeconds: 0,
      },
    ]);

    const graph = buildVideoGraph(timeline, FORMAT);

    expect(graph.filterLines[0]).toContain("[0:v]trim=start=1:end=3");
    expect(graph.filterLines[0]).toMatch(/\[pre0\]$/);
    expect(graph.filterLines[1]).toBe("[pre0]tpad=stop_mode=clone:stop_duration=3.000[scene0]");
  });

  it("trims further when the footage provides more than the scene needs", () => {
    const timeline = timelineOf([
      {
        beatId: "b1",
        footagePath: "/media/f1.mp4",
        sourceInSeconds: 0,
        sourceOutSeconds: 10,
        narrationPath: "/media/n1.wav",
        narrationDurationSeconds: 3,
        sceneDurationSeconds: 3,
        holdLastFrameSeconds: 0,
        startOffsetSeconds: 0,
      },
    ]);

    const graph = buildVideoGraph(timeline, FORMAT);
    expect(graph.filterLines[1]).toBe("[pre0]trim=end=3.000,setpts=PTS-STARTPTS[scene0]");
  });

  it("crossfades consecutive scenes with offset equal to each scene's start on the timeline", () => {
    const timeline = timelineOf(
      [
        {
          beatId: "b1",
          footagePath: "/media/f1.mp4",
          sourceInSeconds: 0,
          sourceOutSeconds: 4,
          narrationPath: "/media/n1.wav",
          narrationDurationSeconds: 4,
          sceneDurationSeconds: 4,
          holdLastFrameSeconds: 0,
          startOffsetSeconds: 0,
        },
        {
          beatId: "b2",
          footagePath: "/media/f2.mp4",
          sourceInSeconds: 0,
          sourceOutSeconds: 4,
          narrationPath: "/media/n2.wav",
          narrationDurationSeconds: 4,
          sceneDurationSeconds: 4,
          holdLastFrameSeconds: 0,
          startOffsetSeconds: 3.5,
        },
      ],
      0.5,
    );

    const graph = buildVideoGraph(timeline, FORMAT, 2);

    expect(graph.inputPaths).toEqual(["/media/f1.mp4", "/media/f2.mp4"]);
    expect(graph.filterLines[0]).toContain("[2:v]trim");
    expect(graph.filterLines[1]).toContain("[3:v]trim");
    expect(graph.outputLabel).toBe("x1");
    expect(graph.filterLines.at(-1)).toBe("[scene0][scene1]xfade=transition=fade:duration=0.500:offset=3.500[x1]");
  });

  it("offsets input indices by startInputIndex", () => {
    const timeline = timelineOf([
      {
        beatId: "b1",
        footagePath: "/media/f1.mp4",
        sourceInSeconds: 0,
        sourceOutSeconds: 4,
        narrationPath: "/media/n1.wav",
        narrationDurationSeconds: 4,
        sceneDurationSeconds: 4,
        holdLastFrameSeconds: 0,
        startOffsetSeconds: 0,
      },
    ]);

    const graph = buildVideoGraph(timeline, FORMAT, 5);
    expect(graph.filterLines[0]?.startsWith("[5:v]")).toBe(true);
  });
});

describe("escapeFilterPath", () => {
  it("escapes backslashes, single quotes and colons", () => {
    expect(escapeFilterPath(String.raw`/tmp/it's:mine\here.ass`)).toBe(String.raw`/tmp/it\'s\:mine\\here.ass`);
  });

  it("leaves an ordinary absolute path unchanged apart from quoting concerns", () => {
    expect(escapeFilterPath("/tmp/renders/beat.ass")).toBe("/tmp/renders/beat.ass");
  });
});

describe("applyCaptionsBurnIn", () => {
  it("appends a subtitles filter reading from the video graph's output label", () => {
    const timeline = timelineOf([
      {
        beatId: "b1",
        footagePath: "/media/f1.mp4",
        sourceInSeconds: 0,
        sourceOutSeconds: 4,
        narrationPath: "/media/n1.wav",
        narrationDurationSeconds: 4,
        sceneDurationSeconds: 4,
        holdLastFrameSeconds: 0,
        startOffsetSeconds: 0,
      },
    ]);
    const video = buildVideoGraph(timeline, FORMAT);

    const withCaptions = applyCaptionsBurnIn(video, "/tmp/renders/beat.ass");

    expect(withCaptions.outputLabel).toBe("vout");
    expect(withCaptions.filterLines).toHaveLength(video.filterLines.length + 1);
    expect(withCaptions.filterLines.at(-1)).toBe("[scene0]subtitles=filename='/tmp/renders/beat.ass'[vout]");
    expect(withCaptions.inputPaths).toEqual(video.inputPaths);
  });
});

const NO_MUSIC: MusicPlan = { enabled: false, volume: 0, reason: "test — no bed" };
const WITH_MUSIC: MusicPlan = {
  enabled: true,
  provider: "stub",
  trackId: "bed-1",
  volume: 0.3,
  reason: "test — a bed under the narration",
};

function twoSceneTimeline(): Timeline {
  return timelineOf(
    [
      {
        beatId: "b1",
        footagePath: "/media/f1.mp4",
        sourceInSeconds: 0,
        sourceOutSeconds: 4,
        narrationPath: "/media/n1.wav",
        narrationDurationSeconds: 4,
        sceneDurationSeconds: 4,
        holdLastFrameSeconds: 0,
        startOffsetSeconds: 0,
      },
      {
        beatId: "b2",
        footagePath: "/media/f2.mp4",
        sourceInSeconds: 0,
        sourceOutSeconds: 4,
        narrationPath: "/media/n2.wav",
        narrationDurationSeconds: 4,
        sceneDurationSeconds: 4,
        holdLastFrameSeconds: 0,
        startOffsetSeconds: 3.5,
      },
    ],
    0.5,
  );
}

describe("buildAudioGraph", () => {
  it("delays each scene's narration to its own start offset and mixes them", () => {
    const graph = buildAudioGraph(twoSceneTimeline(), NO_MUSIC, undefined, 2);

    expect(graph.inputPaths).toEqual(["/media/n1.wav", "/media/n2.wav"]);
    expect(graph.filterLines[0]).toBe(
      "[2:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=0|0[narr0]",
    );
    expect(graph.filterLines[1]).toBe(
      "[3:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=3500|3500[narr1]",
    );
    expect(graph.filterLines[2]).toBe("[narr0][narr1]amix=inputs=2:duration=longest:normalize=0[narrmix]");
  });

  it("passes the narration mix straight through as aout when music is disabled", () => {
    const graph = buildAudioGraph(twoSceneTimeline(), NO_MUSIC, undefined);
    expect(graph.outputLabel).toBe("aout");
    expect(graph.filterLines.at(-1)).toBe("[narrmix]anull[aout]");
    expect(graph.inputPaths).toEqual(["/media/n1.wav", "/media/n2.wav"]);
  });

  it("loops and ducks a music bed under the narration when music is enabled", () => {
    const graph = buildAudioGraph(twoSceneTimeline(), WITH_MUSIC, "/media/bed.mp3", 0);

    expect(graph.inputPaths).toEqual(["/media/n1.wav", "/media/n2.wav", "/media/bed.mp3"]);
    const musicLine = graph.filterLines.find((line) => line.includes("musicbase"));
    expect(musicLine).toContain("[2:a]aformat=sample_rates=44100:channel_layouts=stereo");
    expect(musicLine).toContain("aloop=loop=-1:size=2e9");
    expect(musicLine).toContain("atrim=end=7.500");
    expect(musicLine).toContain("volume=0.3");
    expect(graph.filterLines).toContain("[narrmix]asplit=2[narrmixsidechain][narrmixout]");
    expect(graph.filterLines).toContain(
      "[musicbase][narrmixsidechain]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=250:makeup=1[musicducked]",
    );
    expect(graph.filterLines.at(-1)).toBe(
      "[narrmixout][musicducked]amix=inputs=2:duration=longest:normalize=0[aout]",
    );
    expect(graph.outputLabel).toBe("aout");
  });

  it("throws when music is enabled but no music path was resolved", () => {
    expect(() => buildAudioGraph(twoSceneTimeline(), WITH_MUSIC, undefined)).toThrow(/no music file path/);
  });
});
