"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
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
    <main style={{ maxWidth: 640, margin: "60px auto", padding: "0 20px" }}>
      <h1>ShortReelCuts</h1>
      <p style={{ color: "#666" }}>
        Turn a prompt into a short vertical video. Every decision explained and overridable.
      </p>

      <form onSubmit={handleSubmit} style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label htmlFor="prompt" style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>
            Describe your video
          </label>
          <textarea
            id="prompt"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. A fascinating 20-second history of Venice and its wooden pilings"
            disabled={loading}
            style={{ width: "100%", padding: 12, fontSize: 16, boxSizing: "border-box" }}
            required
          />
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="duration" style={{ display: "block", fontSize: 14, marginBottom: 4 }}>
              Target length (seconds)
            </label>
            <input
              id="duration"
              type="number"
              min={5}
              max={60}
              value={targetSeconds}
              onChange={(e) => setTargetSeconds(Number(e.target.value))}
              disabled={loading}
              style={{ width: "100%", padding: 8, fontSize: 14, boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="tone" style={{ display: "block", fontSize: 14, marginBottom: 4 }}>
              Tone
            </label>
            <select
              id="tone"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              disabled={loading}
              style={{ width: "100%", padding: 8, fontSize: 14, boxSizing: "border-box" }}
            >
              <option value="calm">Calm</option>
              <option value="energetic">Energetic</option>
              <option value="curious">Curious</option>
            </select>
          </div>
        </div>

        {error && <div style={{ color: "#c00", fontSize: 14 }}>{error}</div>}

        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          style={{
            padding: "12px 20px",
            fontSize: 16,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            background: "#000",
            color: "#fff",
            border: "none",
            borderRadius: 4,
          }}
        >
          {loading ? "Creating render job..." : "Generate video"}
        </button>
      </form>
    </main>
  );
}
