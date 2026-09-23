import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GeneratedFootageSchema,
  MotionFootageSchema,
  StockFootageSchema,
} from "@shortreelcuts/plan";
import { GeneratedFootageAdapter } from "./generated.js";
import { MotionFootageAdapter } from "./motion.js";
import { StockFootageAdapter } from "./stock.js";
import type { BeatContext, FootageAdapter, MediaSink } from "../types.js";

function makeBeatContext(overrides?: Partial<BeatContext>): BeatContext {
  return {
    beatId: "b1",
    narration: "A high-mountain harvest in the morning mist.",
    onScreen: "High-mountain harvest",
    search: "mountain tea harvest",
    format: { width: 1080, height: 1920, fps: 30 },
    targetSeconds: 4,
    ...overrides,
  };
}

function makeMockMediaSink(): MediaSink {
  const store = new Map<string, Uint8Array>();
  return {
    async put(bytes: Uint8Array, _contentType: string): Promise<string> {
      const hash = createHash("sha256").update(bytes).digest("hex");
      const key = `sha256:${hash}`;
      store.set(key, bytes);
      return key;
    },
  };
}

describe("Footage adapters (stock, generated, motion)", () => {
  const media = makeMockMediaSink();

  it("all three footage adapters implement the shared FootageAdapter interface", async () => {
    const adapters: FootageAdapter[] = [
      new StockFootageAdapter(),
      new GeneratedFootageAdapter(),
      new MotionFootageAdapter(),
    ];

    expect(adapters.map((a) => a.source)).toEqual(["stock", "generated", "motion"]);

    for (const adapter of adapters) {
      const caps = await adapter.capabilities();
      expect(caps.source).toBe(adapter.source);
      expect(caps.aspectRatios).toContain("9:16");

      const candidates = await adapter.propose(makeBeatContext(), 2);
      expect(candidates).toHaveLength(2);
      expect(candidates[0]?.source).toBe(adapter.source);

      const estimate = adapter.estimate(candidates[0]!);
      expect(estimate.basis).toBeTruthy();
      expect(typeof estimate.requiresConfirmation).toBe("boolean");

      const clip = await adapter.materialise(candidates[0]!, { media });
      expect(clip.source).toBe(adapter.source);
      expect(clip.reason).toBeTruthy();
    }
  });

  it("stock footage adapter produces schema-valid StockFootage", async () => {
    const adapter = new StockFootageAdapter({ id: "pexels" });
    const candidates = await adapter.propose(makeBeatContext(), 1);
    const candidate = candidates[0]!;

    const estimate = adapter.estimate(candidate);
    expect(estimate.kind).toBe("free");
    expect(estimate.requiresConfirmation).toBe(false);

    const clip = await adapter.materialise(candidate, { media });
    expect(() => StockFootageSchema.parse(clip)).not.toThrow();
    expect(clip.provider).toBe("pexels");
    expect(clip.credit.pageUrl).toContain("pexels.com");
  });

  it("generated footage adapter produces schema-valid GeneratedFootage with media key and quoted cost", async () => {
    const adapter = new GeneratedFootageAdapter({ model: "veo-3.1", pricePerSecond: 0.1 });
    const candidates = await adapter.propose(makeBeatContext({ targetSeconds: 5 }), 1);
    const candidate = candidates[0]!;

    const estimate = adapter.estimate(candidate);
    expect(estimate.kind).toBe("per-second");
    expect(estimate.requiresConfirmation).toBe(true);
    expect(estimate.amount).toBe(0.5);

    const clip = await adapter.materialise(candidate, { media });
    expect(() => GeneratedFootageSchema.parse(clip)).not.toThrow();
    expect(clip.output?.mediaKey).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(clip.quotedCost.amount).toBe(0.5);
  });

  it("motion footage adapter produces schema-valid MotionFootage for both code and template scenes", async () => {
    const adapter = new MotionFootageAdapter({ model: "connected-model" });
    const candidates = await adapter.propose(makeBeatContext(), 2);

    const codeCandidate = candidates[0]!;
    expect(codeCandidate.data.scene.kind).toBe("code");
    const codeClip = await adapter.materialise(codeCandidate, { media });
    expect(() => MotionFootageSchema.parse(codeClip)).not.toThrow();
    expect(codeClip.scene.kind).toBe("code");

    const templateCandidate = candidates[1]!;
    expect(templateCandidate.data.scene.kind).toBe("template");
    const templateClip = await adapter.materialise(templateCandidate, { media });
    expect(() => MotionFootageSchema.parse(templateClip)).not.toThrow();
    expect(templateClip.scene.kind).toBe("template");
  });
});
