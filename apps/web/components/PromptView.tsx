"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Info, Clock, Volume2, Film, CheckCircle2 } from "lucide-react";

const SUGGESTIONS = [
  "A 20-second history of Venice and its wooden pilings",
  "Why deep sea creatures produce bioluminescent light",
  "How ancient Roman aqueducts survived earthquakes",
];

const DURATION_PRESETS = [15, 20, 30, 45, 60];

export function PromptView() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [targetSeconds, setTargetSeconds] = useState(20);
  const [tone, setTone] = useState("calm");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, targetSeconds, tone }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Server error: ${res.status}`);
      }

      const data = await res.json();
      router.push(`/projects/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      {/* Honest First-Run / Model Connection Banner */}
      <div className="banner banner-info" role="region" aria-label="Engine status">
        <Info size={18} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
        <div style={{ flex: 1 }}>
          <strong style={{ display: "block", marginBottom: 2 }}>Self-hosted deterministic engine active</strong>
          <span>
            No external cloud models required. When no API keys or local Ollama instances are configured in <code>.env</code>, ShortReelCuts uses built-in reproducible providers to craft and render short reels.
          </span>
        </div>
      </div>

      <header style={{ marginBottom: 28 }}>
        <h1 className="page-title">Generate a short reel</h1>
        <p className="page-subtitle">
          Turn any topic into a vertical video. Every decision the pipeline makes is visible, explained, and individually overridable on the decision sheet.
        </p>
      </header>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="prompt" className="form-label">
              <span>Describe your video</span>
              <span className="badge badge-neutral">Required</span>
            </label>
            <textarea
              id="prompt"
              aria-label="Video prompt"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A fascinating 20-second history of Venice and its wooden pilings"
              disabled={loading}
              className="form-textarea"
              required
            />
            <span className="form-help">
              State the subject, angle, or core question. The script stage derives the hook and pacing from this prompt.
            </span>

            {/* Quick suggestion chips */}
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 12, color: "var(--mut)", display: "block", marginBottom: 6 }}>
                Or start with a topic:
              </span>
              <div className="chips-row">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chip"
                    onClick={() => setPrompt(s)}
                    disabled={loading}
                  >
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 16, marginBottom: 20 }}>
            {/* Target Duration */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="duration" className="form-label">
                <span>Target length (seconds)</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{targetSeconds}s</span>
              </label>
              <input
                id="duration"
                type="number"
                min={5}
                max={60}
                value={targetSeconds}
                onChange={(e) => setTargetSeconds(Number(e.target.value))}
                disabled={loading}
                className="form-input"
              />
              <div className="chips-row" style={{ marginTop: 8 }}>
                {DURATION_PRESETS.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    role="button"
                    aria-label={`${sec}s`}
                    aria-pressed={targetSeconds === sec}
                    className="chip"
                    onClick={() => setTargetSeconds(sec)}
                    disabled={loading}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>

            {/* Tone Selector */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="tone" className="form-label">
                <span>Tone</span>
                <span className="badge badge-neutral">Script voice</span>
              </label>
              <select
                id="tone"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                disabled={loading}
                className="form-select"
              >
                <option value="calm">Calm — measured, documentary pacing</option>
                <option value="energetic">Energetic — punchy, high-momentum</option>
                <option value="curious">Curious — inquisitive, mystery hook</option>
                <option value="dramatic">Dramatic — bold, cinematic beats</option>
              </select>
              <span className="form-help">
                Directs narrator pacing and background music selection.
              </span>
            </div>
          </div>

          {error && (
            <div className="banner banner-bad" role="alert" style={{ marginBottom: 20 }}>
              <strong>Failed to create job:</strong> {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 16, borderTop: "1px solid var(--line)", paddingTop: 18 }}>
            <span style={{ fontSize: 13, color: "var(--faint)", marginRight: "auto" }}>
              Pressing generate starts stage 1 (script).
            </span>

            <button
              type="submit"
              disabled={loading || !prompt.trim()}
              className="btn btn-primary"
              aria-label="Generate video"
            >
              <Sparkles size={16} aria-hidden="true" />
              <span>{loading ? "Creating render job..." : "Generate video"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
