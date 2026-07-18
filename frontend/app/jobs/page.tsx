/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Briefcase, ArrowLeft, ExternalLink, MapPin, Building2, BookmarkCheck, Bookmark, Calendar, FileText, X, SlidersHorizontal } from "lucide-react";
import { marked } from "marked";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import JobCard from "@/components/JobCard";
import JobFilters, { DEFAULT_FILTERS, type JobFilterValues } from "@/components/JobFilters";
import { listJobs, listSavedJobs, saveJob, unsaveJob, getJobMatch, generateCoverLetter, Job, JobMatchResult, ApiError } from "@/lib/api";

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


  if (authLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!user) return null;

  return (
    <div className="container animate-fade-in py-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/")}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-lg font-semibold">{showSaved ? "Saved Jobs" : "Browse Jobs"}</h1>
            <p className="text-sm text-muted-foreground">{showSaved ? `${savedJobs.length} saved` : `${total} jobs available`}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setShowFilters(!showFilters)}>
            <SlidersHorizontal className="mr-1.5 h-4 w-4" />Filters
          </Button>
          <Button variant={showSaved ? "default" : "outline"} size="sm" onClick={() => { setShowSaved(!showSaved); setSelectedJob(null); }}>
            {showSaved ? <><Briefcase className="mr-1.5 h-4 w-4" />All Jobs</> : <><BookmarkCheck className="mr-1.5 h-4 w-4" />Saved ({savedJobs.length})</>}
          </Button>
        </div>
      </div>

      {!showSaved && (
        <div className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.q}
              onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
              placeholder="Search jobs by title or company..."
              className="pl-9"
            />
          </div>
          {filters.q && (
            <Button variant="ghost" size="sm" onClick={() => setFilters((prev) => ({ ...prev, q: "" }))}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Filters sidebar */}
        {!showSaved && showFilters && (
          <div className="w-full shrink-0 lg:w-56">
            <div className="sticky top-20">
              <JobFilters
                filters={filters}
                onChange={setFilters}
                onReset={() => setFilters(DEFAULT_FILTERS)}
              />
            </div>
          </div>
        )}

        {/* Job list */}
        <div className={`flex-1 space-y-2 ${selectedJob ? "hidden lg:block lg:w-1/2" : "w-full"}`}>
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
          <div className="w-full lg:w-1/2">
            <div className="sticky top-20 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    {selectedJob.company_logo ? (
                      <img src={selectedJob.company_logo} alt={selectedJob.company_name} className="h-10 w-10 rounded object-contain"
                        onError={(e) => { const img = e.target as HTMLImageElement; img.style.display = "none"; if (img.parentElement) img.parentElement.textContent = selectedJob.company_name[0] ?? "?"; }} />
                    ) : <Building2 className="h-6 w-6" />}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">{selectedJob.title}</h2>
                    <p className="text-muted-foreground">{selectedJob.company_name}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                    if (savedIds.has(selectedJob.id)) handleUnsave(selectedJob.id); else handleSave(selectedJob.id);
                  }}>
                    {savedIds.has(selectedJob.id) ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => selectedJob.application_url && window.open(selectedJob.application_url, "_blank")}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mb-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {selectedJob.is_remote && <Badge variant="secondary">Remote</Badge>}
                {selectedJob.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{selectedJob.location}</span>}
                {selectedJob.employment_type && <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" />{selectedJob.employment_type}</span>}
                {selectedJob.posted_at && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(selectedJob.posted_at).toLocaleDateString()}</span>}
              </div>

              {matchLoading ? (
                <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Computing match...</div>
              ) : matchResult && (
                <div className="mb-4 rounded-lg border border-border bg-muted/50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">Match Score</span>
                    <span className={`text-lg font-bold ${matchResult.score >= 70 ? "text-green-600" : matchResult.score >= 40 ? "text-amber-600" : "text-muted-foreground"}`}>
                      {matchResult.score}%
                    </span>
                  </div>
                  <div className="space-y-1">
                    <ScoreBar label="Skills" score={matchResult.breakdown.skills} max={40} />
                    <ScoreBar label="Role" score={matchResult.breakdown.role} max={30} />
                    <ScoreBar label="Location" score={matchResult.breakdown.location} max={15} />
                    <ScoreBar label="Experience" score={matchResult.breakdown.experience} max={15} />
                  </div>
                  {matchResult.details.matched_skills.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {matchResult.details.matched_skills.slice(0, 8).map((s) => (
                        <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {selectedJob.salary_min != null && (
                <div className="mb-4 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{selectedJob.currency || "$"}{selectedJob.salary_min?.toLocaleString()}{selectedJob.salary_max ? ` - ${selectedJob.currency || "$"}${selectedJob.salary_max.toLocaleString()}` : "+"}</span>
                </div>
              )}

              <Separator className="mb-4" />

              <div className="prose prose-sm max-w-none text-sm text-muted-foreground">
                {selectedJob.description ? (
                  <div dangerouslySetInnerHTML={{ __html: marked.parse(selectedJob.description, { breaks: true }) }} />
                ) : (
                  <p className="italic">No description available.</p>
                )}
              </div>

              {selectedJob.requirements.length > 0 && (
                <div className="mb-4">
                  <h3 className="mb-2 text-sm font-medium text-foreground">Requirements</h3>
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {selectedJob.requirements.map((req, i) => (
                      <li key={i}>{req}</li>
                    ))}
                  </ul>
                </div>
              )}

              <Separator className="my-4" />

              <div className="space-y-3">
                {!coverLetter ? (
                  <Button variant="outline" className="w-full" onClick={handleGenerateCover} disabled={coverLoading}>
                    {coverLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />}
                    Generate Cover Letter
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">Cover Letter</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setCoverLetter(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                      {coverLetter}
                    </div>
                  </div>
                )}

                {selectedJob.application_url && (
                  <Button className="w-full" onClick={() => window.open(selectedJob.application_url!, "_blank", "noopener,noreferrer")}>
                    <ExternalLink className="mr-1.5 h-4 w-4" />
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
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-muted-foreground/20">
        <div className={`h-full rounded-full ${pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-muted-foreground/40"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right text-muted-foreground">{score}/{max}</span>
    </div>
  );
}
