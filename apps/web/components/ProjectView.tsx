"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Play,
  Download,
  FileCode,
  ArrowLeft,
  RefreshCw,
  Sparkles,
  Volume2,
  Film,
  Type,
  Music,
  Sliders,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export interface DecisionCandidate {
  id: string;
  label: string;
  chosen?: boolean;
}

export interface DecisionItem {
  id: string;
  stage: string;
  label: string;
  chosen: string;
  reason: string;
  candidates?: readonly DecisionCandidate[];
}

export interface StageProgress {
  stage: string;
  status: "pending" | "running" | "done";
  decisions: DecisionItem[];
}

export interface JobProgressData {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  completedStages: string[];
  stages: StageProgress[];
  decisions: DecisionItem[];
  plan: any;
  videoPath: string | null;
  errorMessage: string | null;
}

const STAGE_ICONS: Record<string, any> = {
  script: Type,
  voice: Volume2,
  footage: Film,
  align: Clock,
  frames: Sliders,
  compose: Sparkles,
};

export function ProjectView({ id }: { id: string }) {
  const [data, setData] = useState<JobProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeOverride, setActiveOverride] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<Record<string, string>>({});

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
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div className="banner banner-bad" role="alert">
          <AlertCircle size={20} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>Unable to load job</strong>
            <p style={{ margin: "4px 0 0 0" }}>{error}</p>
          </div>
        </div>
        <Link href="/" className="btn btn-secondary">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Back to prompt</span>
        </Link>
      </div>
    );
  }

  // Loading skeleton state
  if (!data) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ width: 200, height: 28 }} className="skeleton" />
          <div style={{ width: 120, height: 36 }} className="skeleton" />
        </div>
        <div className="progress-strip" style={{ marginBottom: 32 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{ height: 60 }} className="skeleton" />
          ))}
        </div>
        <div className="card" style={{ height: 260 }}>
          <div style={{ width: "40%", height: 20, marginBottom: 16 }} className="skeleton" />
          <div style={{ width: "100%", height: 140 }} className="skeleton" />
        </div>
      </div>
    );
  }

  const isComplete = data.status === "done";
  const isFailed = data.status === "failed";
  const isRunning = data.status === "running";

  return (
    <div>
      {/* Top Breadcrumb & Header */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Link href="/" className="btn btn-ghost btn-sm" style={{ padding: "0 8px", marginLeft: -8 }}>
              <ArrowLeft size={14} aria-hidden="true" />
              <span>New video</span>
            </Link>
            <span style={{ color: "var(--faint)" }}>/</span>
            <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--mut)" }}>
              {data.id}
            </span>
          </div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            Render &amp; decision sheet
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`badge ${isComplete ? "badge-ok" : isFailed ? "badge-bad" : isRunning ? "badge-warn" : "badge-neutral"}`}>
              {isComplete && <CheckCircle2 size={12} aria-hidden="true" />}
              {isRunning && <RefreshCw size={12} className="animate-spin" aria-hidden="true" />}
              {isFailed && <AlertCircle size={12} aria-hidden="true" />}
              <span>{data.status}</span>
            </span>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>
              {data.completedStages?.length ?? 0} of 6 stages completed
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <Link href={`/projects/${id}/plan`} className="btn btn-secondary">
            <FileCode size={16} aria-hidden="true" />
            <span>View plan JSON</span>
          </Link>
        </div>
      </div>

      {/* Failure Banner */}
      {isFailed && (
        <div className="banner banner-bad" role="alert">
          <AlertCircle size={20} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>Pipeline error encountered:</strong>
            <p style={{ margin: "4px 0 0 0" }}>{data.errorMessage ?? "An unexpected error occurred during rendering."}</p>
          </div>
        </div>
      )}

      {/* Pipeline Progress Strip */}
      <section aria-label="Pipeline progress" style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 className="section-title" style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--mut)" }}>
            Stage Graph
          </h2>
          <span style={{ fontSize: 12, color: "var(--faint)" }}>Deterministic execution</span>
        </div>

        <div className="progress-strip">
          {(data.stages || [
            { stage: "script", status: "pending", decisions: [] },
            { stage: "voice", status: "pending", decisions: [] },
            { stage: "footage", status: "pending", decisions: [] },
            { stage: "align", status: "pending", decisions: [] },
            { stage: "frames", status: "pending", decisions: [] },
            { stage: "compose", status: "pending", decisions: [] },
          ]).map((s) => {
            const Icon = STAGE_ICONS[s.stage] || Clock;
            return (
              <div key={s.stage} className={`stage-step ${s.status}`}>
                <div className="stage-step-title">
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon size={14} style={{ color: s.status === "done" ? "var(--ok)" : s.status === "running" ? "var(--warn)" : "var(--mut)" }} aria-hidden="true" />
                    <span>{s.stage}</span>
                  </span>
                  {s.status === "done" && <CheckCircle2 size={13} style={{ color: "var(--ok)" }} aria-hidden="true" />}
                </div>
                <div className="stage-step-status">
                  {s.status === "running" ? "Processing..." : s.status}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Render Result (when complete) */}
      {isComplete && (
        <section aria-label="Rendered video" className="video-preview-card">
          <div className="video-frame-container" role="img" aria-label="Video preview frame">
            <div style={{ textAlign: "center", padding: 16 }}>
              <div style={{ width: 56, height: 56, borderRadius: "var(--r-pill)", background: "var(--acc)", display: "grid", placeItems: "center", margin: "0 auto 12px", color: "var(--on-acc)" }}>
                <Play size={24} fill="currentColor" aria-hidden="true" />
              </div>
              <span style={{ fontSize: 12, color: "#fff", fontWeight: 600, display: "block" }}>
                1080 × 1920 HD
              </span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
                Vertical 9:16
              </span>
            </div>
          </div>

          <div className="video-details">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="badge badge-ok">Render complete</span>
              <span style={{ fontSize: 12, color: "var(--faint)", fontFamily: "var(--font-mono)" }}>30 fps · MP4</span>
            </div>

            <h3 style={{ margin: "0", fontSize: 18, fontFamily: "var(--font-display)" }}>
              Vertical short ready
            </h3>

            <p style={{ margin: 0, fontSize: 14, color: "var(--mut)", lineHeight: 1.5 }}>
              Composed and encoded with exact stage parameters. Output stored locally on disk.
            </p>

            {data.videoPath && (
              <div style={{ background: "var(--bg)", border: "1px solid var(--bd)", borderRadius: "var(--r-md)", padding: "10px 14px", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--ink2)", wordBreak: "break-all" }}>
                <span style={{ color: "var(--faint)", marginRight: 6 }}>Path:</span>
                <code>{data.videoPath}</code>
              </div>
            )}

            <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
              <a
                href={data.videoPath ?? "#"}
                download
                className="btn btn-primary"
                aria-label="Download video"
              >
                <Download size={16} aria-hidden="true" />
                <span>Download video</span>
              </a>
            </div>
          </div>
        </section>
      )}

      {/* Decision Sheet Section */}
      <section aria-label="Decision sheet" data-testid="decision-sheet">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <div>
            <h2 className="section-title">The Decision Sheet</h2>
            <p className="section-desc">
              Every choice made by completed stages, recorded with the reasoning behind it.
            </p>
          </div>
          <span className="decision-count" style={{ fontSize: 12, color: "var(--faint)", whiteSpace: "nowrap" }}>
            {data.decisions?.length ?? 0} decisions recorded
          </span>
        </div>

        {(!data.decisions || data.decisions.length === 0) ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Clock size={24} aria-hidden="true" />
            </div>
            <h3 className="empty-state-title">Waiting for decisions to land</h3>
            <p className="empty-state-desc">
              As each stage in the pipeline completes, its choices, rejected candidates, and recorded reasons appear here immediately.
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table" aria-label="Pipeline decisions">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Stage</th>
                  <th style={{ width: 220 }}>Decision</th>
                  <th>Chosen</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.decisions.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className="badge badge-neutral" style={{ textTransform: "capitalize" }}>
                        {d.stage}
                      </span>
                    </td>
                    <td>
                      <div className="decision-label" style={{ fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap" }}>{d.label}</div>
                      {d.candidates && d.candidates.length > 1 && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ fontSize: 11, color: "var(--faint)", display: "block", marginBottom: 4 }}>
                            Alternative candidates:
                          </span>
                          <div className="chips-row">
                            {d.candidates.map((c) => {
                              const isCurrent = c.label === d.chosen;
                              return (
                                <span
                                  key={c.id}
                                  className="chip"
                                  style={{
                                    fontSize: 11,
                                    padding: "3px 8px",
                                    height: "auto",
                                    minHeight: "auto",
                                    whiteSpace: "nowrap",
                                    background: isCurrent ? "var(--accbg)" : "var(--surf)",
                                    borderColor: isCurrent ? "var(--acc)" : "var(--bd2)",
                                    color: isCurrent ? "var(--acc)" : "var(--mut)",
                                    fontWeight: isCurrent ? 600 : 400,
                                  }}
                                >
                                  {c.label}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="decision-chosen">{d.chosen}</span>
                    </td>
                    <td>
                      <span className="decision-reason">{d.reason}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
