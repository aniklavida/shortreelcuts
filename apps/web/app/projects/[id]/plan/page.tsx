"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

export default function PlanEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;

  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1>Plan Document (Screen 3)</h1>
        <Link href={`/projects/${id}`}>Back to decisions</Link>
      </header>

      {error && <p style={{ color: "#c00" }}>{error}</p>}

      {!plan ? (
        <p>Loading plan...</p>
      ) : (
        <pre
          style={{
            background: "#f4f4f4",
            padding: 16,
            borderRadius: 6,
            overflowX: "auto",
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          {JSON.stringify(plan, null, 2)}
        </pre>
      )}
    </main>
  );
}
