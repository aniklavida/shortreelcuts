import type { FormatPlan } from "@shortreelcuts/plan";
import { describe, expect, it } from "vitest";
import { applyCaptionsBurnIn, buildVideoGraph, escapeFilterPath } from "./filtergraph.js";
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
