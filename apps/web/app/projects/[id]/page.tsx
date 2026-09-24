"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

interface DecisionItem {
  id: string;
  stage: string;
  label: string;
  chosen: string;
  reason: string;
}

interface StageProgress {
  stage: string;
  status: "pending" | "running" | "done";
  decisions: DecisionItem[];
}

interface JobProgressData {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  completedStages: string[];
  stages: StageProgress[];
  decisions: DecisionItem[];
  plan: any;
  videoPath: string | null;
  errorMessage: string | null;
}

export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;

  const [data, setData] = useState<JobProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchStatus() {
      try {
        const res = await fetch(`/api/jobs/${id}`);
        if (!res.ok) {
          throw new Error(`Failed to load job ${id}: ${res.status}`);
        }
        const json = await res.json();
        if (active) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void fetchStatus();

    const interval = setInterval(() => {
      if (data?.status === "done" || data?.status === "failed") {
        clearInterval(interval);
        return;
      }
      void fetchStatus();
    }, 1000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [id, data?.status]);

  if (error) {
    return (
      <main style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px" }}>
        <p style={{ color: "#c00" }}>Error: {error}</p>
        <Link href="/">Back to prompt</Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px" }}>
        <p>Loading project decisions...</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: "0 0 4px 0", fontSize: 24 }}>Render &amp; Decision Sheet</h1>
          <p style={{ margin: 0, color: "#666", fontSize: 14 }}>
            Job: <code>{data.id}</code> · Status: <strong>{data.status}</strong>
          </p>
        </div>
        <nav style={{ display: "flex", gap: 12 }}>
          <Link href={`/projects/${id}/plan`} style={{ fontSize: 14 }}>
            View Plan JSON
          </Link>
          <Link href="/" style={{ fontSize: 14 }}>
            New Video
          </Link>
        </nav>
      </header>

      {/* Progress Strip */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, textTransform: "uppercase", letterSpacing: "0.05em", color: "#555" }}>
          Pipeline Progress
        </h2>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {data.stages?.map((s) => (
            <div
              key={s.stage}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 4,
                border: "1px solid #ccc",
                background: s.status === "done" ? "#e6f4ea" : s.status === "running" ? "#fff8e1" : "#f5f5f5",
                color: s.status === "done" ? "#137333" : s.status === "running" ? "#b06000" : "#777",
                fontSize: 12,
                fontWeight: 600,
                textAlign: "center",
              }}
            >
              {s.stage}
              <div style={{ fontSize: 10, fontWeight: 400, marginTop: 2 }}>{s.status}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Render Result */}
      {data.status === "done" && data.videoPath && (
        <section style={{ padding: 16, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, marginBottom: 32 }}>
          <h3 style={{ margin: "0 0 8px 0", color: "#166534" }}>Video Rendered</h3>
          <p style={{ margin: 0, fontSize: 14 }}>
            Output file: <code>{data.videoPath}</code>
          </p>
        </section>
      )}

      {/* Decision Sheet */}
      <section>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Decision Sheet</h2>
        <p style={{ color: "#666", fontSize: 13, marginBottom: 16 }}>
          Every choice recorded by completed stages, along with the reasoning.
        </p>

        {(!data.decisions || data.decisions.length === 0) ? (
          <p style={{ fontStyle: "italic", color: "#888" }}>Waiting for first stage decisions to land...</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #ddd" }}>
                <th style={{ padding: 8, fontSize: 12 }}>Stage</th>
                <th style={{ padding: 8, fontSize: 12 }}>Decision</th>
                <th style={{ padding: 8, fontSize: 12 }}>Chosen</th>
                <th style={{ padding: 8, fontSize: 12 }}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {data.decisions.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: 8, fontSize: 12, color: "#666", textTransform: "capitalize" }}>{d.stage}</td>
                  <td style={{ padding: 8, fontSize: 13, fontWeight: 600 }}>{d.label}</td>
                  <td style={{ padding: 8, fontSize: 13 }}>{d.chosen}</td>
                  <td style={{ padding: 8, fontSize: 12, color: "#555" }}>{d.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
