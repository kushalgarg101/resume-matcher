"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { createAnalysis, getAnalysis, Analysis, ApiError } from "@/lib/api";
import ResultCard from "@/components/ResultCard";

export default function UploadPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [jdText, setJdText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Lets the polling loop bail out if the component unmounts (e.g. user
  // navigates away) so we never setState on an unmounted component.
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  if (!loading && !user) {
    router.replace("/login");
    return null;
  }

  const poll = async (id: string) => {
    // The worker job has a generous timeout (job_timeout=600s on the backend,
    // plus up to 2 RQ retries with 10s intervals), so a slow run on the free
    // tier (worker cold-start + several LLM attempts + backoff) can take several
    // minutes. Poll for ~5 min so a valid-but-slow job completes in-poll rather
    // than bailing early; the History page also auto-refreshes in-progress rows
    // as a fallback.
    for (let i = 0; i < 150; i++) {
      if (cancelledRef.current) return;
      await new Promise((r) => setTimeout(r, 2000));
      if (cancelledRef.current) return;
      let a: Analysis;
      try {
        a = await getAnalysis(id);
      } catch (err) {
        // Stop polling on auth failure or hard errors; surface to the user.
        if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
          if (err.status === 401) {
            setError("Session expired. Please sign in again.");
            router.replace("/login");
          } else {
            setError("Analysis not found.");
          }
          return;
        }
        setError("Could not refresh status. Stopping polling.");
        return;
      }
      setAnalysis(a);
      if (a.status === "completed" || a.status === "failed") return;
    }
    setError("Still processing — check the History page for the latest status.");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please attach a resume PDF.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const created = await createAnalysis(jdText, file);
      setAnalysis(created);
      await poll(created.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Session expired. Please sign in again.");
        router.replace("/login");
      } else if (err instanceof Error) {
        setError(err.message || "Upload failed");
      } else {
        setError("Upload failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container">
      <div className="card">
        <a href="/">← Back</a>
        <h1>New analysis</h1>
        <form onSubmit={submit}>
          <label>Job description</label>
          <textarea rows={6} value={jdText} onChange={(e) => setJdText(e.target.value)} required />
          <label>Resume (PDF)</label>
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button disabled={busy} style={{ marginTop: "1rem" }}>
            {busy ? "Processing…" : "Score match"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
      {analysis && <ResultCard analysis={analysis} />}
    </main>
  );
}
