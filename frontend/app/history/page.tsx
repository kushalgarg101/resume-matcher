"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { listAnalyses, Analysis, ApiError } from "@/lib/api";
import ResultCard from "@/components/ResultCard";

export default function HistoryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Analysis[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const load = () => {
      listAnalyses()
        .then((data) => {
          if (!active) return;
          setItems(data);
          // If any row is still in flight, refresh once more shortly so the
          // user sees completion without a manual reload. Stop after ~30s.
          const hasPending = data.some(
            (a) => a.status === "queued" || a.status === "processing"
          );
          if (hasPending && !pollTimer) {
            pollTimer = setTimeout(() => {
              pollTimer = null;
              if (active) load();
            }, 5000);
          }
        })
        .catch((e) => {
          if (!active) return;
          if (e instanceof ApiError && e.status === 401) {
            router.replace("/login");
          } else {
            setError(e.message || "Failed to load history.");
          }
        });
    };

    load();
    return () => {
      active = false;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [user, router]);

  if (loading) return <main className="container">Loading…</main>;
  if (!user) return null;

  return (
    <main className="container">
      <div className="card">
        <a href="/">← Back</a>
        <h1>History</h1>
        {error && <p className="error">{error}</p>}
        {items.length === 0 && <p className="muted">No analyses yet.</p>}
      </div>
      {items.map((a) => (
        <ResultCard key={a.id} analysis={a} />
      ))}
    </main>
  );
}
