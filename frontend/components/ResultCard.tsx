"use client";

import { Check, Loader2, X } from "lucide-react";
import { Analysis } from "@/lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ScoreRing from "@/components/ScoreRing";
import StatusBadge from "@/components/StatusBadge";

export default function ResultCard({ analysis }: { analysis: Analysis }) {
  const pending = analysis.status === "queued" || analysis.status === "processing";
  const date = analysis.created_at
    ? new Date(analysis.created_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <Card className="animate-fade-in">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate text-base">{analysis.filename}</CardTitle>
          {date && <p className="text-xs text-muted-foreground">{date}</p>}
        </div>
        <StatusBadge status={analysis.status} />
      </CardHeader>

      <CardContent className="space-y-5">
        {pending && (
          <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {analysis.status === "queued"
              ? "Waiting in queue…"
              : "Analyzing your resume…"}
            <span className="ml-auto text-xs">This can take a minute</span>
          </div>
        )}

        {analysis.status === "failed" && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <X className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Processing failed: {analysis.error_message ?? "Unknown error"}</span>
          </div>
        )}

        {analysis.status === "completed" && !analysis.result && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <X className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Result unavailable — the stored match report could not be read.
              Please re-run the analysis.
            </span>
          </div>
        )}

        {analysis.status === "completed" && analysis.result && (
          <>
            <div className="flex items-center gap-6">
              <ScoreRing score={analysis.result.score} />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Match score
                </p>
                <p className="text-sm text-muted-foreground">
                  {analysis.result.score >= 70
                    ? "Strong fit — you're covering most requirements."
                    : analysis.result.score >= 40
                    ? "Decent fit — a few gaps to close."
                    : "Weak fit — consider tailoring your resume."}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-success" />
                  <p className="text-sm font-semibold text-foreground">
                    Matched skills
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.result.matched_skills.length > 0 ? (
                    analysis.result.matched_skills.map((s) => (
                      <Badge key={s} variant="success">
                        {s}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">None</span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <X className="h-4 w-4 text-destructive" />
                  <p className="text-sm font-semibold text-foreground">
                    Missing skills
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.result.missing_skills.length > 0 ? (
                    analysis.result.missing_skills.map((s) => (
                      <Badge key={s} variant="destructive">
                        {s}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">None</span>
                  )}
                </div>
              </div>
            </div>

            {analysis.result.rationale && (
              <div className="rounded-lg border-l-2 border-primary/50 bg-secondary/30 px-3 py-2">
                <p className="text-sm text-muted-foreground">
                  {analysis.result.rationale}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
