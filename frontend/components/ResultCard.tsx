"use client";

import { Analysis } from "@/lib/api";

/**
 * Renders an analysis card. While status is queued/processing it shows a
 * spinner-like message; once completed it shows the score, matched/missing
 * skills, and rationale.
 */
export default function ResultCard({ analysis }: { analysis: Analysis }) {
  const pending = analysis.status === "queued" || analysis.status === "processing";

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{analysis.filename}</h2>
      {pending && <p className="muted">Status: {analysis.status}… (this can take a minute on the free tier)</p>}
      {analysis.status === "failed" && (
        <p className="error">Processing failed: {analysis.error_message}</p>
      )}
      {analysis.status === "completed" && !analysis.result && (
        <p className="error">
          Result unavailable — the stored match report could not be read. Please
          re-run the analysis.
        </p>
      )}
      {analysis.status === "completed" && analysis.result && (
        <>
          <p className="score">{analysis.result.score}/100</p>
          <p>{analysis.result.rationale}</p>
          <h3>Matched skills</h3>
          <div>
            {analysis.result.matched_skills.map((s) => (
              <span key={s} className="tag good">{s}</span>
            ))}
            {analysis.result.matched_skills.length === 0 && <span className="muted">None</span>}
          </div>
          <h3>Missing skills</h3>
          <div>
            {analysis.result.missing_skills.map((s) => (
              <span key={s} className="tag bad">{s}</span>
            ))}
            {analysis.result.missing_skills.length === 0 && <span className="muted">None</span>}
          </div>
        </>
      )}
    </div>
  );
}
