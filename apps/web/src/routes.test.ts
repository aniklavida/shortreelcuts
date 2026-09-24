/**
 * HTTP-level tests for apps/web routes.
 *
 * Proves the two Done-when criteria:
 * - "A browser refresh mid-render loses nothing; the job continues and reattaches —
 *    proven by an HTTP-level test against the new web routes (not just the worker-level test that already exists)."
 * - "The status route surfaces stage-by-stage decisions as they land, not just a percentage —
 *    proven by a test."
 *
 * Runs against a real HTTP server on 127.0.0.1 and makes real fetch() network requests.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@shortreelcuts/db";
import type { PgBoss } from "pg-boss";
import { handleCreateJob, handleGetJob } from "../lib/jobs.js";
import { setTestServerContext } from "../lib/server.js";

interface StoredJob {
  id: string;
  status: string;
  input: any;
  plan: any;
  completedStages: string[];
  candidates: Record<string, any>;
  videoPath: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const jobStore = new Map<string, StoredJob>();
const enqueuedJobs: string[] = [];

// Mock @shortreelcuts/db so real createJobAndEnqueue and getJobProgress run against in-memory state
vi.mock("@shortreelcuts/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shortreelcuts/db")>();
  return {
    ...actual,
    createJob: vi.fn(async (_db: Database, input: any) => {
      const id = `test-job-${jobStore.size + 1}-${Date.now()}`;
      const job: StoredJob = {
        id,
        status: "pending",
        input,
        plan: null,
        completedStages: [],
        candidates: {},
        videoPath: null,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      jobStore.set(id, job);
      return id;
    }),
    getJob: vi.fn(async (_db: Database, id: string) => {
      return jobStore.get(id);
    }),
  };
});

// Mock queue so enqueueing records without needing a real Postgres pg-boss instance
vi.mock("../../worker/src/queue.js", () => {
  return {
    enqueueRender: vi.fn(async (_boss: PgBoss, jobId: string) => {
      enqueuedJobs.push(jobId);
    }),
  };
});

describe("apps/web HTTP routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Start real HTTP server on 127.0.0.1
    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
        const path = url.pathname;

        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const bodyBuffer = Buffer.concat(chunks);
        const bodyStr = bodyBuffer.toString("utf8");

        const webReq = new Request(url.href, {
          method: req.method,
          headers: req.headers as HeadersInit,
          body: req.method !== "GET" && req.method !== "HEAD" && bodyStr.length > 0 ? bodyStr : undefined,
        });

        let webRes: Response;
        if (path === "/api/jobs" && req.method === "POST") {
          webRes = await handleCreateJob(webReq);
        } else if (path.startsWith("/api/jobs/") && req.method === "GET") {
          const id = path.slice("/api/jobs/".length);
          webRes = await handleGetJob(webReq, id);
        } else {
          webRes = new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
        }

        res.statusCode = webRes.status;
        webRes.headers.forEach((val, key) => res.setHeader(key, val));
        const resText = await webRes.text();
        res.end(resText);
      } catch (e: any) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e?.message ?? "internal error" }));
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    setTestServerContext({
      db: {} as unknown as Database,
      boss: {} as unknown as PgBoss,
    });
  });

  afterAll(async () => {
    setTestServerContext(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    jobStore.clear();
    enqueuedJobs.length = 0;
  });

  it("a browser refresh mid-render loses nothing and reattaches over HTTP", async () => {
    // 1. Client creates a job via HTTP POST
    const createRes = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "A brief history of clock towers",
        targetSeconds: 15,
        tone: "calm",
      }),
    });
    expect(createRes.status).toBe(201);
    const { id: jobId } = await createRes.json();
    expect(jobId).toBeDefined();

    // 2. Simulate worker starting the job and completing script & voice mid-render
    const job = jobStore.get(jobId)!;
    job.status = "running";
    job.completedStages = ["script", "voice"];
    job.plan = {
      planVersion: 2,
      seed: 42,
      brief: { prompt: "A brief history of clock towers", targetSeconds: 15, tone: "calm" },
      script: {
        hook: "Tick tock through time",
        beats: [
          { id: "b1", narration: "Before digital time, bells governed the day.", search: "bell tower medieval", onScreen: "Bells Governed All" },
        ],
        reason: "concise narrative pacing",
      },
      voice: {
        voiceId: "en-neutral",
        rate: 1.0,
        provider: "stub-voice",
        reason: "neutral pacing matches calm tone",
      },
    };

    // 3. Client checks status over HTTP mid-render
    const initialGet = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    expect(initialGet.status).toBe(200);
    const midRenderData = await initialGet.json();
    expect(midRenderData.id).toBe(jobId);
    expect(midRenderData.status).toBe("running");
    expect(midRenderData.completedStages).toEqual(["script", "voice"]);
    expect(midRenderData.stages.find((s: any) => s.stage === "script")?.status).toBe("done");
    expect(midRenderData.stages.find((s: any) => s.stage === "voice")?.status).toBe("done");
    expect(midRenderData.stages.find((s: any) => s.stage === "footage")?.status).toBe("running");
    expect(midRenderData.stages.find((s: any) => s.stage === "align")?.status).toBe("pending");
    expect(midRenderData.decisions.length).toBeGreaterThan(0);

    // 4. "Browser Refresh": A fresh HTTP GET request reattaches and loses nothing
    const refreshGet = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    expect(refreshGet.status).toBe(200);
    const reattachedData = await refreshGet.json();
    expect(reattachedData.id).toBe(jobId);
    expect(reattachedData.status).toBe("running");
    expect(reattachedData.completedStages).toEqual(["script", "voice"]);
    expect(reattachedData.stages).toEqual(midRenderData.stages);
    expect(reattachedData.decisions).toEqual(midRenderData.decisions);

    // 5. Worker finishes all stages and marks done
    job.completedStages = ["script", "voice", "footage", "align", "frames", "compose"];
    job.status = "done";
    job.videoPath = "/work/clock-towers.mp4";

    // 6. Next client poll over HTTP receives final completed video and state
    const finalGet = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    expect(finalGet.status).toBe(200);
    const finalData = await finalGet.json();
    expect(finalData.status).toBe("done");
    expect(finalData.videoPath).toBe("/work/clock-towers.mp4");
    expect(finalData.completedStages).toEqual(["script", "voice", "footage", "align", "frames", "compose"]);
  });

  it("the status route surfaces stage-by-stage decisions as they land", async () => {
    // 1. Create a job
    const createRes = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "The secret life of coral reefs" }),
    });
    const { id: jobId } = await createRes.json();
    const job = jobStore.get(jobId)!;

    // 2. Before any stage completes: zero decisions, status pending
    const res0 = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    const data0 = await res0.json();
    expect(data0.status).toBe("pending");
    expect(data0.completedStages).toEqual([]);
    expect(data0.decisions).toEqual([]);

    // 3. Stage 1 (script) lands
    job.status = "running";
    job.completedStages = ["script"];
    job.plan = {
      planVersion: 2,
      seed: 99,
      brief: { prompt: "The secret life of coral reefs", targetSeconds: 20, tone: "curious" },
      script: {
        hook: "Underneath the waves lies a bustling city",
        beats: [
          { id: "b1", narration: "Corals are not rocks, but living creatures.", search: "coral polyps macro", onScreen: "Living Architecture" },
        ],
        reason: "educational curiosity angle",
      },
    };

    const res1 = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    const data1 = await res1.json();
    expect(data1.completedStages).toEqual(["script"]);
    const scriptDecisions = data1.decisions.filter((d: any) => d.stage === "script");
    expect(scriptDecisions.length).toBeGreaterThan(0);
    // Every decision has chosen and reason (not a percentage!)
    for (const d of scriptDecisions) {
      expect(d.chosen).toBeDefined();
      expect(typeof d.chosen).toBe("string");
      expect(d.reason).toBeDefined();
      expect(typeof d.reason).toBe("string");
      expect(d.reason.length).toBeGreaterThan(0);
    }
    expect(data1.decisions.some((d: any) => d.id === "script.hook" && d.chosen === "Underneath the waves lies a bustling city")).toBe(true);

    // 4. Stage 2 (voice) lands
    job.completedStages = ["script", "voice"];
    job.plan.voice = {
      voiceId: "en-neutral",
      rate: 1.05,
      provider: "stub-voice",
      reason: "clear tone suited for documentary style",
    };

    const res2 = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    const data2 = await res2.json();
    expect(data2.completedStages).toEqual(["script", "voice"]);
    const voiceDecisions = data2.decisions.filter((d: any) => d.stage === "voice");
    expect(voiceDecisions.length).toBe(2);
    expect(voiceDecisions.find((d: any) => d.id === "voice.voiceId")?.reason).toBe("clear tone suited for documentary style");

    // 5. Stage 3 (footage) lands
    job.completedStages = ["script", "voice", "footage"];
    job.plan.footage = {
      b1: {
        source: "stock",
        assetId: "stock-coral-01",
        reason: "vibrant close-up of polyp tentacles feeding",
      },
    };
    const res3 = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    const data3 = await res3.json();
    const footageDecisions = data3.decisions.filter((d: any) => d.stage === "footage");
    expect(footageDecisions.length).toBe(1);
    expect(footageDecisions[0].reason).toBe("vibrant close-up of polyp tentacles feeding");

    // 6. Stage 4 (align) lands
    job.completedStages = ["script", "voice", "footage", "align"];
    job.plan.align = {
      words: { b1: [{ word: "Corals", start: 0, end: 0.5 }] },
      reason: "whisper alignment matched to audio waveform",
    };
    const res4 = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    const data4 = await res4.json();
    const alignDecisions = data4.decisions.filter((d: any) => d.stage === "align");
    expect(alignDecisions.length).toBe(1);
    expect(alignDecisions[0].reason).toBe("whisper alignment matched to audio waveform");

    // 7. Stage 5 (frames) lands
    job.completedStages = ["script", "voice", "footage", "align", "frames"];
    job.plan.frames = {
      sequence: "frames_001.png",
      reason: "rendered 30fps frames for overlay",
    };
    const res5 = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    const data5 = await res5.json();
    const framesDecisions = data5.decisions.filter((d: any) => d.stage === "frames");
    expect(framesDecisions.length).toBe(1);

    // 8. Stage 6 (compose) lands and completes video
    job.completedStages = ["script", "voice", "footage", "align", "frames", "compose"];
    job.status = "done";
    job.videoPath = "/work/coral.mp4";
    job.plan.captions = {
      style: "bold-white-outline",
      position: "lower-third",
      wordsPerCue: 3,
      reason: "high contrast readability against colorful background",
    };
    job.plan.music = {
      enabled: true,
      volume: 0.15,
      provider: "stock",
      reason: "subtle ambient background track",
    };
    job.plan.format = {
      width: 1080,
      height: 1920,
      fps: 30,
      container: "mp4",
    };

    const res6 = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    const data6 = await res6.json();
    expect(data6.status).toBe("done");
    const composeDecisions = data6.decisions.filter((d: any) => d.stage === "compose");
    expect(composeDecisions.length).toBeGreaterThan(0);
    expect(composeDecisions.find((d: any) => d.id === "captions.style")?.reason).toBe("high contrast readability against colorful background");
  });

  it("rejects invalid job input with 400 Bad Request", async () => {
    const res = await fetch(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "   " }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/prompt is required/);
  });

  it("returns 404 for unknown job id", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/missing-job-id-9999`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toMatch(/not found/i);
  });
});
