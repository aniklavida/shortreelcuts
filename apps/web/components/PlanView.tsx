"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Check, FileCode, AlertCircle, Download } from "lucide-react";

export function PlanView({ id }: { id: string }) {
  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchPlan() {
      try {
        const res = await fetch(`/api/jobs/${id}`);
        if (!res.ok) throw new Error(`Failed to load job: ${res.status}`);
        const data = await res.json();
        setPlan(data.plan);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    void fetchPlan();
  }, [id]);

  const handleCopy = () => {
    if (!plan) return;
    navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!plan) return;
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plan-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Link href={`/projects/${id}`} className="btn btn-ghost btn-sm" style={{ padding: "0 8px", marginLeft: -8 }}>
              <ArrowLeft size={14} aria-hidden="true" />
              <span>Back to decisions</span>
            </Link>
            <span style={{ color: "var(--faint)" }}>/</span>
            <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--mut)" }}>
              {id}
            </span>
          </div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            Plan document
          </h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>
            The versioned, seeded JSON plan that serves as the single source of truth for the renderer.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!plan}
            className="btn btn-secondary btn-sm"
            aria-label="Copy plan JSON"
          >
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            <span>{copied ? "Copied" : "Copy JSON"}</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!plan}
            className="btn btn-secondary btn-sm"
            aria-label="Download plan JSON"
          >
            <Download size={14} aria-hidden="true" />
            <span>Download</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="banner banner-bad" role="alert" style={{ marginBottom: 20 }}>
          <AlertCircle size={20} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>Error loading plan:</strong>
            <p style={{ margin: "4px 0 0 0" }}>{error}</p>
          </div>
        </div>
      )}

      {!plan ? (
        <div className="card" style={{ height: 320 }}>
          <div style={{ width: 180, height: 20, marginBottom: 16 }} className="skeleton" />
          <div style={{ width: "100%", height: 220 }} className="skeleton" />
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", background: "var(--subtle)", borderBottom: "1px solid var(--bd)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span className="badge badge-neutral">v{plan.planVersion ?? 2}</span>
              {typeof plan.seed === "number" && (
                <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--mut)" }}>
                  Seed: <strong>{plan.seed}</strong>
                </span>
              )}
            </div>
            <span style={{ fontSize: 12, color: "var(--faint)" }}>
              {Object.keys(plan).length} root keys
            </span>
          </div>
          <pre className="code-block" style={{ margin: 0, border: "none", borderRadius: 0 }}>
            {JSON.stringify(plan, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
