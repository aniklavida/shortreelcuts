import { describe, expect, it, vi } from "vitest";
import {
  executeSceneRenderContract,
  monitorProcessMemory,
  registerPopupClosingRule,
  MemoryCeilingExceededError,
  WarmUpCaptureRequiredError,
  type RenderContextLike,
  type RenderPageLike,
  type SceneProcessLike,
} from "./motion.js";

class MockPage implements RenderPageLike {
  private closed = false;
  readonly screenshots: { type?: string }[] = [];
  readonly evaluations: Array<{ fnString: string; args: unknown[] }> = [];

  constructor(public readonly pageUrl = "about:blank") {}

  async close(): Promise<void> {
    this.closed = true;
  }

  isClosed(): boolean {
    return this.closed;
  }

  async evaluate<T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]): Promise<T> {
    this.evaluations.push({ fnString: String(fn), args });
    return undefined as unknown as T;
  }

  async screenshot(options?: { type?: string }): Promise<Uint8Array> {
    this.screenshots.push(options ?? {});
    return new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
  }

  url(): string {
    return this.pageUrl;
  }
}

class MockContext implements RenderContextLike {
  private pageListener?: (page: RenderPageLike) => void;
  readonly pages: MockPage[] = [];

  async newPage(): Promise<RenderPageLike> {
    const page = new MockPage();
    this.pages.push(page);
    this.pageListener?.(page);
    return page;
  }

  on(event: "page", listener: (page: RenderPageLike) => void): void {
    if (event === "page") {
      this.pageListener = listener;
    }
  }

  async close(): Promise<void> {}
}

describe("Motion render contract spike additions", () => {
  it("warm-up capture before real frame 0", async () => {
    const page = new MockPage();
    const context = new MockContext();

    const realFramesReceived: number[] = [];
    let warmUpScreenshotsAtFirstRealFrame = 0;

    const trace = await executeSceneRenderContract({
      page,
      context,
      totalFrames: 5,
      options: {
        warmUpCaptures: 3,
        settleTimeMs: 10,
        closePopups: true,
      },
      onRealFrame: (frameIndex) => {
        if (frameIndex === 0) {
          // Exactly 3 discarded screenshots plus the current real frame 0
          warmUpScreenshotsAtFirstRealFrame = page.screenshots.length;
        }
        realFramesReceived.push(frameIndex);
      },
    });

    expect(warmUpScreenshotsAtFirstRealFrame).toBe(4); // 3 warm-up + frame 0
    expect(trace.warmUpCapturesCompleted).toBe(3);
    expect(trace.realFramesCaptured).toBe(5);
    expect(realFramesReceived).toEqual([0, 1, 2, 3, 4]);

    // Total screenshots: 3 warm-up + 5 real frames = 8
    expect(page.screenshots).toHaveLength(8);

    // Warm-up capture cannot be zero or negative — the render contract requires it
    await expect(
      executeSceneRenderContract({
        page: new MockPage(),
        context: new MockContext(),
        totalFrames: 2,
        options: { warmUpCaptures: 0 },
      }),
    ).rejects.toThrow(WarmUpCaptureRequiredError);
  });

  it("OS-level memory ceiling enforcement", async () => {
    let killedSignal: string | undefined;
    const mockProcess: SceneProcessLike = {
      pid: 99999,
      kill(signal) {
        killedSignal = signal;
      },
    };

    let simulatedRssMb = 50;
    const sampleRss = async () => simulatedRssMb;

    // Ceiling is 100 MB
    const monitor = monitorProcessMemory(mockProcess, 100, {
      intervalMs: 10,
      sampleRss,
    });

    // 50 MB is below ceiling -> passes
    await expect(monitor.checkNow()).resolves.toBe(50);
    expect(killedSignal).toBeUndefined();

    // Memory spikes to 250 MB -> exceeds 100 MB ceiling -> terminates process with SIGKILL
    simulatedRssMb = 250;
    await expect(monitor.checkNow()).rejects.toThrow(MemoryCeilingExceededError);
    expect(killedSignal).toBe("SIGKILL");

    monitor.stop();

    // Verify enforcement inside executeSceneRenderContract
    let renderKilledSignal: string | undefined;
    const sceneProcess: SceneProcessLike = {
      pid: 88888,
      kill(sig) {
        renderKilledSignal = sig;
      },
    };

    let renderRss = 40;
    await expect(
      executeSceneRenderContract({
        page: new MockPage(),
        context: new MockContext(),
        process: sceneProcess,
        totalFrames: 5,
        options: {
          memoryCeilingMb: 80,
          warmUpCaptures: 1,
          settleTimeMs: 0,
        },
        sampleRss: async () => {
          renderRss += 30; // 40 -> 70 -> 100 (> 80 MB ceiling)
          return renderRss;
        },
      }),
    ).rejects.toThrow(MemoryCeilingExceededError);

    expect(renderKilledSignal).toBe("SIGKILL");
  });

  it("explicit popup-closing rule", async () => {
    const context = new MockContext();
    const mainScenePage = await context.newPage();

    let closedCount = 0;
    registerPopupClosingRule(context, mainScenePage, () => {
      closedCount++;
    });

    // Main scene page is open
    expect(mainScenePage.isClosed()).toBe(false);

    // Attack: window.open creates a new page in the context
    const popupPage1 = await context.newPage();
    const popupPage2 = await context.newPage();

    // Both popups must be closed immediately by the rule
    expect(popupPage1.isClosed()).toBe(true);
    expect(popupPage2.isClosed()).toBe(true);
    expect(closedCount).toBe(2);

    // The main scene page must remain unclosed
    expect(mainScenePage.isClosed()).toBe(false);
  });
});
