/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Briefcase, ArrowLeft, ExternalLink, MapPin, Building2, BookmarkCheck, Bookmark, Calendar, FileText, X, SlidersHorizontal, Sparkles } from "lucide-react";
import { marked } from "marked";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import JobCard from "@/components/JobCard";
import JobFilters, { DEFAULT_FILTERS, type JobFilterValues } from "@/components/JobFilters";
import { listJobs, listSavedJobs, saveJob, unsaveJob, getJobMatch, generateCoverLetter, Job, JobMatchResult, ApiError, createPlan, tailorResume, SearchPlan } from "@/lib/api";

export default function JobsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const userId = user?.id;

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<JobFilterValues>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedJobs, setSavedJobs] = useState<Job[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [matchResult, setMatchResult] = useState<JobMatchResult | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [coverLetter, setCoverLetter] = useState<string | null>(null);
  const [coverLoading, setCoverLoading] = useState(false);
  const [matchScores, setMatchScores] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [showFilters, setShowFilters] = useState(true);
  const [copied, setCopied] = useState(false);
  const [plannerQuery, setPlannerQuery] = useState("");
  const [planning, setPlanning] = useState(false);
  const [planResult, setPlanResult] = useState<SearchPlan | null>(null);
  const perPage = 20;

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  loadingRef.current = loading || loadingMore;

  const hasMore = jobs.length < total;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const buildQueryString = useCallback((f: JobFilterValues) => {
    const params: Record<string, string> = {};
    if (f.q) params.q = f.q;
    if (f.source) params.source = f.source;
    if (f.remote !== null) params.remote = String(f.remote);
    if (f.location) params.location = f.location;
    if (f.employment_type.length > 0) params.employment_type = f.employment_type.join(",");
    if (f.experience_level) params.experience_level = f.experience_level;
    if (f.salary_min) params.salary_min = f.salary_min;
    if (f.salary_max) params.salary_max = f.salary_max;
    if (f.posted_within) params.posted_within = f.posted_within;
    if (f.sort) params.sort = f.sort;
    return params;
  }, []);

  const fetchJobs = useCallback(async (f: JobFilterValues, p: number, append?: boolean) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError("");
    try {
      const params = { ...buildQueryString(f), page: p, per_page: perPage };
      const res = await listJobs(params);
      if (append) {
        setJobs((prev) => [...prev, ...res.jobs]);
      } else {
        setJobs(res.jobs);
      }
      setTotal(res.total);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load jobs."); } finally { setLoading(false); setLoadingMore(false); }
  }, [buildQueryString]);

  useEffect(() => {
    if (!userId) return;
    setPage(1);
    setSelectedJob(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchJobs(filters, 1, false);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [userId, filters, fetchJobs]);

  useEffect(() => {
    if (page > 1) {
      fetchJobs(filtersRef.current, page, true);
    }
  }, [page, fetchJobs]);

  useEffect(() => {
    if (!userId) return;
    listSavedJobs().then((sj) => {
      setSavedJobs(sj);
      setSavedIds(new Set(sj.map((j) => j.id)));
    }).catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current && hasMore) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore]);

  const handleSave = async (id: string) => {
    try { await saveJob(id); setSavedIds((prev) => new Set(prev).add(id)); } catch { setError("Failed to save job."); }
  };
  const handleUnsave = async (id: string) => {
    try { await unsaveJob(id); setSavedIds((prev) => { const n = new Set(prev); n.delete(id); return n; }); setSavedJobs((prev) => prev.filter((j) => j.id !== id)); } catch { setError("Failed to unsave job."); }
  };

  const handleSelectJob = async (job: Job) => {
    setSelectedJob(job);
    setMatchResult(null);
    setCoverLetter(null);
    setMatchLoading(true);
    try {
      const m = await getJobMatch(job.id);
      setMatchResult(m);
      setMatchScores((prev) => ({ ...prev, [job.id]: m.score }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // No profile yet — skip match silently
      }
    } finally { setMatchLoading(false); }
  };

  const handleGenerateCover = async () => {
    if (!selectedJob) return;
    setCoverLoading(true);
    try {
      const letter = await generateCoverLetter(selectedJob.id);
      setCoverLetter(letter);
    } catch { setError("Failed to generate cover letter."); } finally { setCoverLoading(false); }
  };

  const handleCopyCoverLetter = () => {
    if (!coverLetter) return;
    navigator.clipboard.writeText(coverLetter);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePlanSearch = async () => {
    if (!plannerQuery.trim()) return;
    setPlanning(true);
    setPlanResult(null);
    try {
      const res = await createPlan(plannerQuery);
      setPlanResult(res.search_plan);
      const f: Partial<JobFilterValues> = {};
      if (res.search_plan.roles?.length) f.q = res.search_plan.roles[0];
      if (res.search_plan.location) f.location = res.search_plan.location;
      if (res.search_plan.remote !== null && res.search_plan.remote !== undefined) f.remote = res.search_plan.remote;
      if (res.search_plan.employment_type) f.employment_type = [res.search_plan.employment_type];
      if (res.search_plan.experience_level) f.experience_level = res.search_plan.experience_level;
      setFilters((prev) => ({ ...prev, ...f }));
    } catch { setError("Failed to create search plan."); } finally { setPlanning(false); }
  };

  if (authLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!user) return null;

  return (
    <div className="container animate-fade-in py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-lg hover:bg-muted" onClick={() => router.push("/")}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">{showSaved ? "Saved Jobs" : "Browse Jobs"}</h1>
            <p className="text-xs font-medium text-muted-foreground mt-0.5">{showSaved ? `${savedJobs.length} saved` : `${total} jobs available`}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="lg:hidden rounded-lg" onClick={() => setShowFilters(!showFilters)}>
            <SlidersHorizontal className="mr-1.5 h-4 w-4" />Filters
          </Button>
          <Button variant={showSaved ? "default" : "outline"} size="sm" className="rounded-lg font-medium" onClick={() => { setShowSaved(!showSaved); setSelectedJob(null); }}>
            {showSaved ? <><Briefcase className="mr-1.5 h-4 w-4" />All Jobs</> : <><BookmarkCheck className="mr-1.5 h-4 w-4" />Saved ({savedJobs.length})</>}
          </Button>
        </div>
      </div>

      {!showSaved && (
        <>
          <div className="mb-4 flex gap-2">
            <div className="relative flex-1">
              <Sparkles className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={plannerQuery}
                onChange={(e) => setPlannerQuery(e.target.value)}
                placeholder='e.g. "backend engineer jobs in Bangalore over 15 LPA"'
                className="pl-10 h-10 rounded-xl bg-card/50 border-border/80 focus:bg-card transition-all"
                onKeyDown={(e) => e.key === "Enter" && handlePlanSearch()}
              />
            </div>
            <Button
              variant="default"
              size="sm"
              className="rounded-xl h-10 shrink-0"
              onClick={handlePlanSearch}
              disabled={planning || !plannerQuery.trim()}
            >
              {planning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
              Plan
            </Button>
          </div>

          {planResult && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs">
              <span className="font-semibold text-primary uppercase tracking-wider">Plan:</span>
              {planResult.roles?.slice(0, 3).map((r) => (
                <Badge key={r} variant="secondary" className="bg-primary/10 text-primary border-0 rounded-full">{r}</Badge>
              ))}
              {planResult.location && (
                <span className="flex items-center gap-1 text-muted-foreground"><MapPin className="h-3 w-3" />{planResult.location}</span>
              )}
              {planResult.salary_min != null && (
                <span className="text-muted-foreground/80">Min: ₹{(planResult.salary_min / 100000).toFixed(1)}L</span>
              )}
              {planResult.remote === true && <Badge variant="secondary" className="bg-green-500/10 text-green-600 border-0 rounded-full">Remote</Badge>}
              {planResult.employment_type && <span className="text-muted-foreground/80 capitalize">{planResult.employment_type}</span>}
              {planResult.experience_level && <span className="text-muted-foreground/80 capitalize">{planResult.experience_level}</span>}
              <button
                onClick={() => setPlanResult(null)}
                className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="mb-6 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/80" />
              <Input
                value={filters.q}
                onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
                placeholder="Search jobs by title, company, or keywords..."
                className="pl-10 h-10 rounded-xl bg-card/50 border-border/80 focus:bg-card transition-all"
              />
            </div>
            {filters.q && (
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl" onClick={() => setFilters((prev) => ({ ...prev, q: "" }))}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </>
      )}

      {error && <p className="mb-6 text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-6 lg:flex-row items-start">
        {/* Filters sidebar */}
        {!showSaved && showFilters && (
          <div className="w-full shrink-0 lg:w-72 lg:sticky lg:top-24">
            <JobFilters
              filters={filters}
              onChange={setFilters}
              onReset={() => setFilters(DEFAULT_FILTERS)}
            />
          </div>
        )}

        {/* Job list */}
        <div className={`flex-1 space-y-3 ${selectedJob ? "hidden lg:block lg:w-1/2" : "w-full"}`}>
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : showSaved ? (
            savedJobs.length === 0
              ? <div className="py-16 text-center text-sm text-muted-foreground">No saved jobs yet.</div>
              : savedJobs.map((job) => (
                  <JobCard key={job.id} job={job} saved onUnsave={handleUnsave} onSelect={handleSelectJob} matchScore={matchScores[job.id] ?? null} />
                ))
          ) : jobs.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {filters.q ? `No jobs matching "${filters.q}".` : "No jobs yet."}
            </div>
          ) : (
            <>
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} saved={savedIds.has(job.id)} onSave={handleSave} onUnsave={handleUnsave} onSelect={handleSelectJob} matchScore={matchScores[job.id] ?? null} />
              ))}
              {loadingMore && (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              )}
              {hasMore && <div ref={sentinelRef} className="h-4" />}
            </>
          )}
        </div>

        {/* Detail panel */}
        {selectedJob && (
          <div className="w-full lg:w-1/2 lg:sticky lg:top-24">
            <div className="max-h-[calc(100vh-8.5rem)] overflow-y-auto rounded-2xl border border-border/80 bg-card/70 backdrop-blur-md p-6 shadow-sm">
              <div className="mb-5 flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-muted to-muted/80 text-muted-foreground shadow-xs">
                    {selectedJob.company_logo ? (
                      <img src={selectedJob.company_logo} alt={selectedJob.company_name} className="h-11 w-11 rounded-lg object-contain"
                        onError={(e) => { const img = e.target as HTMLImageElement; img.style.display = "none"; if (img.parentElement) { img.parentElement.textContent = selectedJob.company_name[0] ?? "?"; img.parentElement.className = "flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary font-semibold text-xl uppercase"; } }} />
                    ) : <Building2 className="h-7 w-7 text-muted-foreground/80" />}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-foreground">{selectedJob.title}</h2>
                    <p className="text-sm font-medium text-primary mt-0.5">{selectedJob.company_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-muted/80 rounded-lg" onClick={() => {
                    if (savedIds.has(selectedJob.id)) handleUnsave(selectedJob.id); else handleSave(selectedJob.id);
                  }}>
                    {savedIds.has(selectedJob.id) ? <BookmarkCheck className="h-5 w-5 text-primary" /> : <Bookmark className="h-5 w-5 text-muted-foreground" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-muted/80 rounded-lg" onClick={() => selectedJob.application_url && window.open(selectedJob.application_url, "_blank")}>
                    <ExternalLink className="h-5 w-5 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-muted/80 rounded-lg" onClick={() => setSelectedJob(null)}>
                    <X className="h-5 w-5 text-muted-foreground" />
                  </Button>
                </div>
              </div>

              <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground/85">
                {selectedJob.is_remote && <Badge variant="secondary" className="bg-primary/10 text-primary border-0 rounded-full font-medium px-2.5 py-0.5">Remote</Badge>}
                {selectedJob.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-muted-foreground/50" />{selectedJob.location}</span>}
                {selectedJob.employment_type && <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5 text-muted-foreground/50" />{selectedJob.employment_type}</span>}
                {selectedJob.posted_at && <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5 text-muted-foreground/50" />{new Date(selectedJob.posted_at).toLocaleDateString()}</span>}
              </div>

              {matchLoading ? (
                <div className="mb-5 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Computing match...</div>
              ) : matchResult && (
                <div className="mb-5 rounded-xl border border-border/80 bg-muted/40 p-4 space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-border/60 pb-3">
                    <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Match Score</span>
                    <span className={`text-2xl font-black tracking-tight ${matchResult.score >= 70 ? "text-green-600" : matchResult.score >= 40 ? "text-amber-600" : "text-muted-foreground"}`}>
                      {matchResult.score}%
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ScoreBar label="Skills" score={matchResult.breakdown.skills} max={40} />
                    <ScoreBar label="Role" score={matchResult.breakdown.role} max={30} />
                    <ScoreBar label="Location" score={matchResult.breakdown.location} max={15} />
                    <ScoreBar label="Experience" score={matchResult.breakdown.experience} max={15} />
                  </div>
                  {matchResult.details.matched_skills.length > 0 && (
                    <div className="pt-2 border-t border-border/60">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">Matched Skills</span>
                      <div className="flex flex-wrap gap-1">
                        {matchResult.details.matched_skills.slice(0, 12).map((s) => (
                          <Badge key={s} variant="secondary" className="bg-primary/5 text-primary border-0 rounded-full text-[10px] font-medium py-0.5 px-2.5">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selectedJob.salary_min != null && (
                <div className="mb-5 flex items-center gap-2 rounded-xl bg-primary/5 px-4 py-3 text-sm text-foreground/90 border border-primary/10">
                  <span className="font-semibold text-primary">Salary Range:</span>
                  <span className="font-bold">{selectedJob.currency || "$"}{selectedJob.salary_min?.toLocaleString()}{selectedJob.salary_max ? ` — ${selectedJob.currency || "$"}${selectedJob.salary_max.toLocaleString()}` : "+"}</span>
                </div>
              )}

              <Separator className="mb-5 bg-border/60" />

              <div className="prose prose-sm max-w-none text-sm text-muted-foreground leading-relaxed">
                {selectedJob.description ? (
                  <div dangerouslySetInnerHTML={{ __html: marked.parse(selectedJob.description, { breaks: true }) }} />
                ) : (
                  <p className="italic text-muted-foreground/60">No description available.</p>
                )}
              </div>

              {selectedJob.requirements.length > 0 && (
                <div className="mb-5 mt-4">
                  <h3 className="mb-2 text-sm font-semibold text-foreground">Requirements</h3>
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {selectedJob.requirements.map((req, i) => (
                      <li key={i}>{req}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-3 pt-4 border-t border-border/60">
                {!coverLetter ? (
                  <Button variant="outline" className="w-full h-10 rounded-xl hover:bg-muted" onClick={handleGenerateCover} disabled={coverLoading}>
                    {coverLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                    Generate Cover Letter
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-xl border border-border/80 bg-muted/40 p-4 shadow-2xs">
                    <div className="flex items-center justify-between pb-2 border-b border-border/40">
                      <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Cover Letter</span>
                      <div className="flex items-center gap-1.5">
                        <Button variant="ghost" size="sm" className="h-7 text-xs hover:bg-muted/80 px-2 rounded-lg" onClick={handleCopyCoverLetter}>
                          {copied ? "Copied!" : "Copy to Clipboard"}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted/80 rounded-lg" onClick={() => setCoverLetter(null)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed pt-2 font-mono text-[13px] max-h-60 overflow-y-auto">
                      {coverLetter}
                    </div>
                  </div>
                )}

                {selectedJob.application_url && (
                  <Button className="w-full h-10 rounded-xl" onClick={() => window.open(selectedJob.application_url!, "_blank", "noopener,noreferrer")}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Apply on Employer Site
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreBar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="w-16 font-medium text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-muted shadow-inner overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-muted-foreground/40"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-semibold text-foreground/80">{score}/{max}</span>
    </div>
  );
}
