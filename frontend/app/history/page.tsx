"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, FileText, Inbox } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { listAnalyses, Analysis, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import ResultCard from "@/components/ResultCard";

function scoreColor(score: number) {
  if (score >= 70) return "text-success";
  if (score >= 40) return "text-primary";
  return "text-destructive";
}

export default function HistoryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Analysis[]>([]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const load = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      setError("");
      listAnalyses()
        .then((data) => {
          if (!active) return;
          setItems(data);
          const hasPending = data.some(
            (a) => a.status === "queued" || a.status === "processing"
          );
          if (hasPending) {
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

  if (loading) {
    return (
      <div className="container flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="container animate-fade-in py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            Analysis History
          </h1>
          <p className="text-sm text-muted-foreground">
            {items.length} {items.length === 1 ? "analysis" : "analyses"}
          </p>
        </div>
        <Button asChild>
          <Link href="/upload">
            <FileText className="h-4 w-4" />
            New analysis
          </Link>
        </Button>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {items.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-6 w-6" />}
          title="No analyses yet"
          description="Run your first match to see results here."
          action={
            <Button asChild>
              <Link href="/upload">Start an analysis</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((a) => {
            const isOpen = expanded === a.id;
            const date = a.created_at
              ? new Date(a.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "—";
            return (
              <div key={a.id}>
                <Card
                  className={cn(
                    "cursor-pointer transition-colors hover:border-primary/40",
                    isOpen && "border-primary/40"
                  )}
                  onClick={() => setExpanded(isOpen ? null : a.id)}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <FileText className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {a.filename}
                      </p>
                      <p className="text-xs text-muted-foreground">{date}</p>
                    </div>

                    {a.status === "completed" && a.result ? (
                      <span
                        className={cn(
                          "text-xl font-bold tabular-nums",
                          scoreColor(a.result.score)
                        )}
                      >
                        {a.result.score}
                      </span>
                    ) : (
                      <StatusBadge status={a.status} />
                    )}

                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                        isOpen && "rotate-180"
                      )}
                    />
                  </CardContent>
                </Card>
                {isOpen && (
                  <div className="mt-2 animate-fade-in">
                    <ResultCard analysis={a} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
