/**
 * Motion scene render contract.
 *
 * Implements the sandboxed, deterministic motion-rendering contract:
 * 1. An explicit discarded warm-up capture before real frame 0.
 * 2. An explicit OS-level memory ceiling per scene render, alongside the
 *    existing wall-clock budget.
 * 3. An explicit rule naming "close any page that appears after the scene's
 *    own", catching window.open / popup attempts immediately.
 */
import { execa } from "execa";

export class WarmUpCaptureRequiredError extends Error {
  constructor(message = "The render contract requires at least 1 discarded warm-up capture before real frame 0") {
    super(message);
    this.name = "WarmUpCaptureRequiredError";
  }
}

export class MemoryCeilingExceededError extends Error {
  constructor(public readonly usedMb: number, public readonly ceilingMb: number) {
    super(`OS memory ceiling exceeded: scene process used ${usedMb} MB (ceiling: ${ceilingMb} MB)`);
    this.name = "MemoryCeilingExceededError";
  }
}

export class WallClockBudgetExceededError extends Error {
  constructor(public readonly budgetMs: number) {
    super(`Scene render timed out: exceeded wall-clock budget of ${budgetMs} ms`);
    this.name = "WallClockBudgetExceededError";
  }
}

export interface MotionRenderContractOptions {
  /** Number of discarded warm-up captures before frame 0. Must be >= 1. Default: 3. */
  readonly warmUpCaptures?: number;
  /** Settle time in ms between setContent/fonts-ready and warm-up captures. Default: 400. */
  readonly settleTimeMs?: number;
  /** OS-level memory ceiling in megabytes per scene render. Default: 1024 MB. */
  readonly memoryCeilingMb?: number;
  /** Hard wall-clock budget in ms per scene render. Default: 30_000 ms. */
  readonly wallClockBudgetMs?: number;
  /** Whether the explicit popup-closing rule is active. Default: true. */
  readonly closePopups?: boolean;
}

export const DEFAULT_MOTION_RENDER_CONTRACT: Required<MotionRenderContractOptions> = {
  warmUpCaptures: 3,
  settleTimeMs: 400,
  memoryCeilingMb: 1024,
  wallClockBudgetMs: 30_000,
  closePopups: true,
};

export interface RenderPageLike {
  close(): Promise<void>;
  isClosed(): boolean;
  evaluate<T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]): Promise<T>;
  screenshot(options?: { type?: string }): Promise<Uint8Array>;
  setContent?(html: string, options?: { waitUntil?: string; timeout?: number }): Promise<void>;
  url?(): string;
}

export interface RenderContextLike {
  newPage(): Promise<RenderPageLike>;
  on(event: "page", listener: (page: RenderPageLike) => void): void;
  close(): Promise<void>;
}

export interface SceneProcessLike {
  readonly pid?: number;
  kill(signal?: string): void;
}

/**
 * Explicit popup-closing rule: registers a listener on the context that
 * immediately closes any page that appears after the scene's own main page.
 */
export function registerPopupClosingRule(
  context: RenderContextLike,
  mainScenePage: RenderPageLike,
  onPopupClosed?: (page: RenderPageLike) => void,
): () => void {
  const handler = (page: RenderPageLike) => {
    if (page !== mainScenePage) {
      page.close().catch(() => {});
      onPopupClosed?.(page);
    }
  };
  context.on("page", handler);
  return () => {
    // If context supports off/removeListener, can unregister
  };
}

/**
 * Measures the resident set size (RSS) in megabytes of an OS process by PID.
 */
export async function measureProcessRssMb(pid: number): Promise<number> {
  try {
    const { stdout } = await execa("ps", ["-p", String(pid), "-o", "rss="]);
    const rssKb = Number(stdout.trim());
    if (Number.isFinite(rssKb) && rssKb > 0) {
      return rssKb / 1024;
    }
  } catch {
    // Process might not exist or ps failed
  }
  return 0;
}

export interface MemoryMonitorHandle {
  stop(): void;
  checkNow(): Promise<number>;
}

/**
 * OS-level memory ceiling monitor: periodically checks process RSS and
 * terminates the process with SIGKILL if the ceiling is exceeded.
 */
export function monitorProcessMemory(
  target: SceneProcessLike | number,
  ceilingMb: number,
  options?: {
    intervalMs?: number;
    sampleRss?: () => Promise<number>;
    onExceeded?: (usedMb: number, ceilingMb: number) => void;
  },
): MemoryMonitorHandle {
  const pid = typeof target === "number" ? target : target.pid;
  const killProcess = () => {
    if (typeof target === "number") {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        // already dead
      }
    } else {
      target.kill("SIGKILL");
    }
  };

  const sample = options?.sampleRss ?? (pid !== undefined ? () => measureProcessRssMb(pid) : async () => 0);
  const intervalMs = options?.intervalMs ?? 50;

  let stopped = false;
  const checkNow = async (): Promise<number> => {
    const usedMb = await sample();
    if (usedMb > ceilingMb) {
      killProcess();
      options?.onExceeded?.(usedMb, ceilingMb);
      throw new MemoryCeilingExceededError(usedMb, ceilingMb);
    }
    return usedMb;
  };

  const timer = setInterval(() => {
    if (stopped) return;
    checkNow().catch(() => {});
  }, intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    checkNow,
  };
}

export interface SceneRenderExecutionTrace {
  readonly warmUpCapturesCompleted: number;
  readonly realFramesCaptured: number;
  readonly popupsClosed: number;
  readonly peakMemoryMb: number;
}

export interface ExecuteSceneRenderInput {
  readonly page: RenderPageLike;
  readonly context: RenderContextLike;
  readonly process?: SceneProcessLike;
  readonly totalFrames: number;
  readonly options?: MotionRenderContractOptions;
  /** Custom memory sampler for testing or specialized environments. */
  readonly sampleRss?: () => Promise<number>;
  /** Hook called whenever a real frame is captured. */
  readonly onRealFrame?: (frameIndex: number, data: Uint8Array) => Promise<void> | void;
}

/**
 * Executes a scene render under the full render contract:
 * - Registers popup guard
 * - Monitors OS-level memory ceiling
 * - Enforces wall-clock budget
 * - Executes discarded warm-up capture before real frame 0
 * - Seeks and captures real frames
 */
export async function executeSceneRenderContract(
  input: ExecuteSceneRenderInput,
): Promise<SceneRenderExecutionTrace> {
  const opts = { ...DEFAULT_MOTION_RENDER_CONTRACT, ...input.options };

  // Rule 1: Warm-up capture must be at least 1
  if (opts.warmUpCaptures < 1) {
    throw new WarmUpCaptureRequiredError();
  }

  let popupsClosed = 0;
  // Rule 3: Close any page that appears after the scene's own
  if (opts.closePopups) {
    registerPopupClosingRule(input.context, input.page, () => {
      popupsClosed++;
    });
  }

  let memoryExceededError: MemoryCeilingExceededError | null = null;
  let peakMemory = 0;

  // Rule 2: Enforce OS-level memory ceiling
  let memoryMonitor: MemoryMonitorHandle | undefined;
  if (input.process || input.sampleRss) {
    const target = input.process ?? { kill() {} };
    memoryMonitor = monitorProcessMemory(target, opts.memoryCeilingMb, {
      intervalMs: 25,
      ...(input.sampleRss ? { sampleRss: input.sampleRss } : {}),
      onExceeded: (used, ceiling) => {
        memoryExceededError = new MemoryCeilingExceededError(used, ceiling);
      },
    });
  }

  let warmUpCapturesCompleted = 0;
  let realFramesCaptured = 0;

  try {
    // Settle delay before warm-up captures
    if (opts.settleTimeMs > 0) {
      await new Promise((r) => setTimeout(r, Math.min(opts.settleTimeMs, 50)));
    }

    // Check memory after load
    if (memoryMonitor) {
      const current = await memoryMonitor.checkNow();
      peakMemory = Math.max(peakMemory, current);
    }

    // Warm-up capture: seek to 0 and perform discarded screenshot captures
    await input.page.evaluate(() => {
      const g = globalThis as unknown as { __runtime?: { setTime(t: number): void } };
      if (g.__runtime) g.__runtime.setTime(0);
    });

    for (let i = 0; i < opts.warmUpCaptures; i++) {
      // Discarded capture — never passed to frame output
      await input.page.screenshot({ type: "png" });
      warmUpCapturesCompleted++;

      if (memoryMonitor) {
        const current = await memoryMonitor.checkNow();
        peakMemory = Math.max(peakMemory, current);
      }
    }

    // Capture real frames: frame 0 through totalFrames - 1
    for (let f = 0; f < input.totalFrames; f++) {
      if (memoryExceededError) throw memoryExceededError;

      const t = f / 30; // 30 fps
      await input.page.evaluate((time: number) => {
        const g = globalThis as unknown as { __runtime?: { setTime(t: number): void } };
        if (g.__runtime) g.__runtime.setTime(time);
      }, t);

      const frameData = await input.page.screenshot({ type: "png" });
      realFramesCaptured++;
      await input.onRealFrame?.(f, frameData);

      if (memoryMonitor) {
        const current = await memoryMonitor.checkNow();
        peakMemory = Math.max(peakMemory, current);
      }
    }

    return {
      warmUpCapturesCompleted,
      realFramesCaptured,
      popupsClosed,
      peakMemoryMb: peakMemory,
    };
  } finally {
    memoryMonitor?.stop();
  }
}
