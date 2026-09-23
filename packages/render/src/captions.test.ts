import { FORMAT_PRESETS, type CaptionsPlan, type FormatPlan } from "@shortreelcuts/plan";
import { describe, expect, it } from "vitest";
import { formatAssTimestamp, formatSrtTimestamp, renderAss, renderSrt } from "./captions.js";
import type { Cue } from "./timeline.js";

const FORMAT: FormatPlan = { width: 1080, height: 1920, fps: 30, container: "mp4" };
const CAPTIONS: CaptionsPlan = {
  style: "bold-white-outline",
  position: "lower-third",
  wordsPerCue: 3,
  reason: "test caption style",
};

describe("formatSrtTimestamp", () => {
  it("formats sub-minute times", () => {
    expect(formatSrtTimestamp(1.234)).toBe("00:00:01,234");
  });

  it("formats times past an hour", () => {
    expect(formatSrtTimestamp(3661.5)).toBe("01:01:01,500");
  });

  it("clamps negative times to zero", () => {
    expect(formatSrtTimestamp(-1)).toBe("00:00:00,000");
  });
});

describe("formatAssTimestamp", () => {
  it("formats with centisecond precision", () => {
    expect(formatAssTimestamp(1.02)).toBe("0:00:01.02");
  });

  it("formats times past an hour without zero-padding the hour", () => {
    expect(formatAssTimestamp(3661.5)).toBe("1:01:01.50");
  });
});

describe("renderSrt", () => {
  it("numbers cues sequentially with blank lines between them", () => {
    const cues: Cue[] = [
      { startSeconds: 0, endSeconds: 1, text: "hello there" },
      { startSeconds: 1, endSeconds: 2.5, text: "general kenobi" },
    ];
    expect(renderSrt(cues)).toBe(
      "1\n00:00:00,000 --> 00:00:01,000\nhello there\n\n2\n00:00:01,000 --> 00:00:02,500\ngeneral kenobi\n",
    );
  });
});

describe("renderAss", () => {
  it("includes the plan's resolution and one dialogue line per cue", () => {
    const cues: Cue[] = [{ startSeconds: 0, endSeconds: 1.2, text: "hello" }];
    const ass = renderAss(cues, CAPTIONS, FORMAT);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:01.20,bold-white-outline,,0,0,0,,hello");
  });

  it("maps lower-third and upper-third and center to distinct ASS alignments", () => {
    const cue: Cue[] = [{ startSeconds: 0, endSeconds: 1, text: "x" }];
    const lower = renderAss(cue, { ...CAPTIONS, position: "lower-third" }, FORMAT);
    const upper = renderAss(cue, { ...CAPTIONS, position: "upper-third" }, FORMAT);
    const center = renderAss(cue, { ...CAPTIONS, position: "center" }, FORMAT);

    expect(lower).toMatch(/Style: bold-white-outline,Arial,\d+,&H00FFFFFF,&H00000000,&H80000000,1,0,1,3,0,2,/);
    expect(upper).toMatch(/,8,/);
    expect(center).toMatch(/,5,/);
  });

  it("escapes ASS override-tag braces in caption text", () => {
    const cues: Cue[] = [{ startSeconds: 0, endSeconds: 1, text: "cost is {free}" }];
    const ass = renderAss(cues, CAPTIONS, FORMAT);
    expect(ass).toContain("cost is \\{free\\}");
  });

  it("sizes the script to the plan's landscape (16:9) shape, not a fixed vertical one", () => {
    const cues: Cue[] = [{ startSeconds: 0, endSeconds: 1, text: "hello" }];
    const ass = renderAss(cues, CAPTIONS, { ...FORMAT_PRESETS["16:9"], fps: 30, container: "mp4" });
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
    // Font size and margins are derived from the format's own height/width.
    expect(ass).toMatch(/Style: bold-white-outline,Arial,49,/);
    expect(ass).toMatch(/,115,115,86,1$/m);
  });
});
