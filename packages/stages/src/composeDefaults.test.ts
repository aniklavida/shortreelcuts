import { describe, expect, it } from "vitest";
import { makeSheetFixturePlan } from "./testing/fixtures.js";
import { withComposeDefaults } from "./composeDefaults.js";

describe("withComposeDefaults", () => {
  it("leaves an already-decided plan's compose-owned fields untouched", () => {
    const plan = makeSheetFixturePlan();
    expect(withComposeDefaults(plan)).toEqual(plan);
  });

  it("fills in captions, music and format when a draft plan doesn't have them yet", () => {
    const draft = makeSheetFixturePlan() as unknown as Record<string, unknown>;
    delete draft["captions"];
    delete draft["music"];
    delete draft["format"];

    const result = withComposeDefaults(draft as never);
    expect(result.captions.wordsPerCue).toBe(3);
    expect(result.music.enabled).toBe(false);
    expect(result.format).toEqual({ width: 1080, height: 1920, fps: 30, container: "mp4" });
  });
});
