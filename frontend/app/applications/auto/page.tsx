"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, MapPin, ExternalLink, FileText, Briefcase, Building2, Check, X, ChevronRight, ArrowLeft, Star } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  createPlan,
  listJobs,
  batchMatchJobs,
  tailorResume,
  generateCoverLetter,
  createApplication,
  SearchPlan,
  Job,
  JobMatchResult,
  ApiError,
  BatchMatchResponse,
} from "@/lib/api";

type Step = "plan" | "rank" | "process" | "done";

interface ScoredJob extends Job {
  matchScore: number;
  breakdown?: JobMatchResult["breakdown"];
}

interface ProcessedJob {
  jobId: string;
  status: "pending" | "tailoring" | "cover" | "ready" | "applied" | "error";
  error?: string;
}

export default function AutoApplyPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>("plan");
  const [query, setQuery] = useState("");
  const [planResult, setPlanResult] = useState<SearchPlan | null>(null);
  const [planning, setPlanning] = useState(false);

  const [jobs, setJobs] = useState<ScoredJob[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [ranking, setRanking] = useState(false);

  const [processed, setProcessed] = useState<Record<string, ProcessedJob>>({});
  const [processing, setProcessing] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);

  const [error, setError] = useState("");
  const [rankAttempted, setRankAttempted] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const handlePlan = async () => {
    if (!query.trim()) return;
    setPlanning(true);
    setError("");
    setJobs([]);
    setSelectedIds(new Set());
    setRankAttempted(false);
    try {
      const res = await createPlan(query);
      setPlanResult(res.search_plan);
      setStep("rank");
    } catch { setError("Failed to create plan."); } finally { setPlanning(false); }
  };

  const handleRank = useCallback(async () => {
    if (!planResult) return;
    setRanking(true);
    setError("");
    try {
      const params: Record<string, string | number | undefined> = {
        page: 1,
        per_page: 50,
      };
      if (planResult.roles?.length) params.q = planResult.roles[0];
      if (planResult.location) params.location = planResult.location;
      if (planResult.remote === true) params.remote = "true";
      if (planResult.employment_type) params.employment_type = planResult.employment_type;
      if (planResult.experience_level) params.experience_level = planResult.experience_level;

      const jobRes = await listJobs(params);
      if (jobRes.jobs.length === 0) {
        setError("No jobs found matching your plan. Try broadening your search.");
        setRanking(false);
        return;
      }

      const jobIds = jobRes.jobs.map((j) => j.id);
      let matchRes: BatchMatchResponse | null = null;
      try {
        matchRes = await batchMatchJobs(jobIds);
      } catch {
        // Silently skip match if profile is missing
      }

      const scored: ScoredJob[] = jobRes.jobs.map((job) => {
        const m = matchRes?.matches?.[job.id];
        return {
          ...job,
          matchScore: m?.score ?? 0,
          breakdown: m?.breakdown,
        };
      });
      scored.sort((a, b) => b.matchScore - a.matchScore);

      setJobs(scored);
      setSelectedIds(new Set(scored.filter((j) => j.matchScore >= 40).slice(0, 10).map((j) => j.id)));
      setStep("process");
    } catch (e) { setError(e instanceof Error ? e.message : "Ranking failed."); } finally { setRanking(false); setRankAttempted(true); }
  }, [planResult]);

  useEffect(() => {
    if (step === "rank" && planResult && !ranking && jobs.length === 0 && !rankAttempted) {
      handleRank();
    }
  }, [step, planResult, ranking, jobs.length, handleRank, rankAttempted]);

  const handleRetryRank = () => {
    setRankAttempted(false);
    setError("");
    setRanking(true);
    handleRank();
  };

  const toggleJob = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleProcess = async () => {
    if (selectedIds.size === 0) return;
    setProcessing(true);
    setError("");

    const init: Record<string, ProcessedJob> = {};
    for (const id of selectedIds) {
      init[id] = { jobId: id, status: "pending" };
    }
    setProcessed(init);

    let count = 0;
    for (const jobId of selectedIds) {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) continue;

      // 1. Tailor resume
      setProcessed((prev) => ({ ...prev, [jobId]: { jobId, status: "tailoring" } }));
      try {
        await tailorResume(jobId);
      } catch {
        setProcessed((prev) => ({ ...prev, [jobId]: { jobId, status: "error", error: "Tailoring failed" } }));
        continue;
      }

      // 2. Generate cover letter
      setProcessed((prev) => ({ ...prev, [jobId]: { jobId, status: "cover" } }));
      let coverLetter: string | undefined;
      try {
        coverLetter = await generateCoverLetter(jobId);
      } catch {
        // Cover letter is optional — continue without it
      }

      // 3. Create application
      try {
        await createApplication(jobId, coverLetter);
        setProcessed((prev) => ({ ...prev, [jobId]: { jobId, status: "ready" } }));
        count++;
        setAppliedCount(count);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Apply failed";
        setProcessed((prev) => ({ ...prev, [jobId]: { jobId, status: "error", error: msg } }));
      }
    }

    setProcessing(false);
    setStep("done");
  };

  if (authLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!user) return null;

  return (
    <div className="container animate-fade-in py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-lg hover:bg-muted" onClick={() => router.push("/applications")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Auto-Apply</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {step === "plan" ? "Describe what you're looking for" :
             step === "rank" ? "Finding matching jobs..." :
             step === "process" ? "Review and select jobs to apply" :
             "Processing complete"}
          </p>
        </div>
      </div>

      {/* Steps indicator */}
      <div className="mb-8 flex items-center gap-2 text-xs font-medium">
        {(["plan", "rank", "process", "done"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
              step === s ? "bg-primary text-primary-foreground" :
              ["plan", "rank", "process", "done"].indexOf(step) > i ? "bg-success/20 text-success" :
              "bg-muted text-muted-foreground"
            }`}>
              {["plan", "rank", "process", "done"].indexOf(step) > i ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={step === s ? "text-foreground" : "text-muted-foreground"}>
              {s === "plan" ? "Plan" : s === "rank" ? "Find" : s === "process" ? "Select" : "Done"}
            </span>
            {i < 3 && <span className="text-muted-foreground/30">→</span>}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <X className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Step 1: Plan */}
      {step === "plan" && (
        <div>
          <div className="mb-6 rounded-2xl border border-border/80 bg-card/60 p-6">
            <h2 className="text-base font-semibold mb-1">What kind of job are you looking for?</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Be specific about role, location, salary, and preferences.
            </p>
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='e.g. "backend engineer jobs in Bangalore over 15 LPA"'
                className="flex-1 h-11 rounded-xl"
                onKeyDown={(e) => e.key === "Enter" && handlePlan()}
              />
              <Button
                variant="default"
                size="lg"
                className="rounded-xl h-11 shrink-0"
                onClick={handlePlan}
                disabled={planning || !query.trim()}
              >
                {planning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Create Plan
              </Button>
            </div>
          </div>

          {/* Quick examples */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Examples</p>
            <div className="flex flex-wrap gap-2">
              {[
                "frontend react developer remote",
                "data scientist 20 LPA",
                "senior devops engineer bangalore",
                "product manager intern mumbai",
              ].map((ex) => (
                <button
                  key={ex}
                  onClick={() => setQuery(ex)}
                  className="rounded-full border border-border/80 px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Finding (auto-transitions) */}
      {step === "rank" && (
        <div className="flex flex-col items-center justify-center py-16">
          {!rankAttempted || ranking ? (
            <>
              <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Searching and ranking jobs...</p>
            </>
          ) : (
            <>
              <p className="mb-4 text-sm text-destructive">Failed to find jobs. Try a different query.</p>
              <Button variant="default" size="sm" className="rounded-xl" onClick={handleRetryRank}>
                <Loader2 className="mr-1.5 h-4 w-4" />
                Retry
              </Button>
            </>
          )}
          {planResult && (
            <div className="mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {planResult.roles?.slice(0, 2).map((r) => (
                <Badge key={r} variant="secondary" className="bg-primary/10 text-primary border-0 rounded-full">{r}</Badge>
              ))}
              {planResult.location && <span className="text-muted-foreground">{planResult.location}</span>}
              {planResult.salary_min != null && (
                <span className="text-muted-foreground/80">Min: ₹{(planResult.salary_min / 100000).toFixed(1)}L</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Select jobs */}
      {step === "process" && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {jobs.length} jobs found — {selectedIds.size} selected. Lower scores need a closer look.
            </p>
            <Button
              variant="default"
              size="sm"
              className="rounded-xl"
              onClick={handleProcess}
              disabled={selectedIds.size === 0 || processing}
            >
              {processing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Briefcase className="mr-1.5 h-4 w-4" />}
              Apply to {selectedIds.size} job{selectedIds.size !== 1 ? "s" : ""}
            </Button>
          </div>

          <div className="space-y-2">
            {jobs.map((job) => {
              const selected = selectedIds.has(job.id);
              return (
                <div
                  key={job.id}
                  className={`rounded-2xl border p-4 transition-all cursor-pointer ${
                    selected
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/80 bg-card/60 hover:border-border"
                  }`}
                  onClick={() => toggleJob(job.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-muted to-muted/80 text-muted-foreground shadow-xs">
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold">{job.title}</h3>
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2 ring-offset-2 ring-offset-background ${
                            job.matchScore >= 70 ? "bg-green-50 text-green-600 ring-green-500/20" :
                            job.matchScore >= 40 ? "bg-amber-50 text-amber-600 ring-amber-500/20" :
                            "bg-muted/80 text-muted-foreground ring-muted"
                          }`}>
                            {job.matchScore}
                          </span>
                        </div>
                        <p className="truncate text-xs font-medium text-muted-foreground mt-0.5">{job.company_name}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground/80">
                          {job.is_remote && <Badge variant="secondary" className="bg-primary/10 text-primary border-0 rounded-full text-[10px]">Remote</Badge>}
                          {job.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{job.location}</span>}
                          {job.employment_type && <span>{job.employment_type}</span>}
                          {job.salary_min != null && (
                            <span className="font-semibold text-foreground/70">
                              ₹{job.salary_min.toLocaleString()}{job.salary_max ? ` - ₹${job.salary_max.toLocaleString()}` : "+"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}>
                      {selected ? <Check className="h-4 w-4" /> : null}
                    </div>
                  </div>

                  {/* Score bars */}
                  {job.breakdown && (
                    <div className="mt-3 grid grid-cols-4 gap-3 border-t border-border/40 pt-3">
                      {(["skills", "role", "location", "experience"] as const).map((k) => {
                        const val = job.breakdown![k];
                        const max = k === "skills" ? 40 : k === "role" ? 30 : 15;
                        const pct = Math.round((val / max) * 100);
                        return (
                          <div key={k} className="space-y-0.5">
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                              <span className="capitalize">{k}</span>
                              <span className="font-medium">{val}/{max}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${
                                pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-muted-foreground/30"
                              }`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 4: Done */}
      {step === "done" && (
        <div className="rounded-2xl border border-border/80 bg-card/60 p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <Check className="h-8 w-8 text-success" />
          </div>
          <h2 className="text-xl font-bold tracking-tight mb-2">Applications Ready</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Processed {appliedCount} of {selectedIds.size} selected jobs.
            {appliedCount < selectedIds.size && ` ${selectedIds.size - appliedCount} had errors.`}
          </p>

          <div className="mb-8 space-y-2 text-left max-w-lg mx-auto">
            {jobs.filter((j) => selectedIds.has(j.id)).map((job) => {
              const p = processed[job.id];
              const statusLabel = p?.status === "ready" ? "Ready to apply" :
                p?.status === "error" ? `Error: ${p.error}` :
                p?.status === "applied" ? "Applied" : "Pending";
              const statusOk = p?.status === "ready" || p?.status === "applied";

              return (
                <div key={job.id} className={`flex items-center justify-between rounded-xl border p-3 text-sm ${
                  statusOk ? "border-success/30 bg-success/5" :
                  p?.status === "error" ? "border-destructive/30 bg-destructive/5" :
                  "border-border/60 bg-muted/30"
                }`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{job.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{job.company_name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-medium ${
                      statusOk ? "text-success" :
                      p?.status === "error" ? "text-destructive" :
                      "text-muted-foreground"
                    }`}>{statusLabel}</span>
                    {job.application_url && statusOk && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-lg text-xs"
                        onClick={() => window.open(job.application_url!, "_blank")}
                      >
                        <ExternalLink className="mr-1 h-3 w-3" />
                        Open
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" className="rounded-xl" onClick={() => router.push("/applications")}>
              View Applications
            </Button>
            <Button variant="default" className="rounded-xl" onClick={() => { setStep("plan"); setPlanResult(null); setJobs([]); setProcessed({}); setAppliedCount(0); }}>
              Start Another
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
