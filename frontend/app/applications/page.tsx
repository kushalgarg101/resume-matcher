"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft, Briefcase, Send, CheckCircle2, XCircle, Clock, Calendar, Building2, ExternalLink, Sparkles, TrendingUp, Plus, Trash2, CalendarDays } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { listApplications, updateApplication, Application, listInterviewStages, createInterviewStage, updateInterviewStage, deleteInterviewStage, InterviewStage, CreateInterviewStage } from "@/lib/api";

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: "Draft", color: "bg-muted text-muted-foreground", icon: <Clock className="h-3 w-3" /> },
  applied: { label: "Applied", color: "bg-blue-100 text-blue-700", icon: <Send className="h-3 w-3" /> },
  interviewing: { label: "Interviewing", color: "bg-amber-100 text-amber-700", icon: <Calendar className="h-3 w-3" /> },
  offer: { label: "Offer", color: "bg-green-100 text-green-700", icon: <CheckCircle2 className="h-3 w-3" /> },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700", icon: <XCircle className="h-3 w-3" /> },
  withdrawn: { label: "Withdrawn", color: "bg-muted text-muted-foreground", icon: <XCircle className="h-3 w-3" /> },
};

const statusOptions = ["draft", "applied", "interviewing", "offer", "rejected", "withdrawn"];

export default function ApplicationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Application | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [stages, setStages] = useState<InterviewStage[]>([]);
  const [stagesLoading, setStagesLoading] = useState(false);
  const [addingStage, setAddingStage] = useState(false);
  const [stageForm, setStageForm] = useState({ stage_name: "", scheduled_at: "", notes: "", prep_materials: "" });
  const stagesAppIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    listApplications()
      .then(setApps)
      .catch(() => setError("Failed to load applications."))
      .finally(() => setLoading(false));
  }, [user]);

  const handleStatusChange = async (appId: string, status: string) => {
    setUpdating(appId);
    try {
      const updated = await updateApplication(appId, { status } as Partial<Application>);
      setApps((prev) => prev.map((a) => (a.id === appId ? updated : a)));
      if (selected?.id === appId) setSelected(updated);
    } catch { setError("Failed to update status."); } finally { setUpdating(null); }
  };

  const loadStages = async (applicationId: string) => {
    stagesAppIdRef.current = applicationId;
    setStagesLoading(true);
    try {
      const data = await listInterviewStages(applicationId);
      if (stagesAppIdRef.current === applicationId) setStages(data);
    } catch { /* silently ignore */ } finally {
      if (stagesAppIdRef.current === applicationId) setStagesLoading(false);
    }
  };

  useEffect(() => {
    if (selected) loadStages(selected.id);
    else setStages([]);
  }, [selected]);

  const handleAddStage = async () => {
    if (!stageForm.stage_name.trim() || !selected) return;
    try {
      await createInterviewStage({
        application_id: selected.id,
        stage_name: stageForm.stage_name.trim(),
        scheduled_at: stageForm.scheduled_at || undefined,
        notes: stageForm.notes || undefined,
        prep_materials: stageForm.prep_materials || undefined,
      } as CreateInterviewStage);
      setStageForm({ stage_name: "", scheduled_at: "", notes: "", prep_materials: "" });
      setAddingStage(false);
      loadStages(selected.id);
    } catch { setError("Failed to add stage."); }
  };

  const handleStageStatusToggle = async (stage: InterviewStage) => {
    const nextStatus = stage.status === "pending" ? "completed" : stage.status === "completed" ? "pending" : stage.status === "cancelled" ? "pending" : "pending";
    try {
      await updateInterviewStage(stage.application_id, stage.id, { status: nextStatus } as {});
      loadStages(stage.application_id);
    } catch { setError("Failed to update stage."); }
  };

  const handleDeleteStage = async (stage: InterviewStage) => {
    try {
      await deleteInterviewStage(stage.application_id, stage.id);
      loadStages(stage.application_id);
    } catch { setError("Failed to delete stage."); }
  };

  if (authLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!user) return null;

  return (
    <div className="container animate-fade-in py-6">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/")}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h1 className="text-lg font-semibold">Applications</h1>
          <p className="text-sm text-muted-foreground">{apps.length} application{apps.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Stats */}
      {!loading && apps.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Total", value: apps.length, icon: Briefcase, color: "text-primary bg-primary/10" },
            { label: "Applied", value: apps.filter((a) => a.status === "applied").length, icon: Send, color: "text-blue-600 bg-blue-100" },
            { label: "Interviewing", value: apps.filter((a) => a.status === "interviewing").length, icon: Calendar, color: "text-amber-600 bg-amber-100" },
            { label: "Offers", value: apps.filter((a) => a.status === "offer").length, icon: CheckCircle2, color: "text-green-600 bg-green-100" },
            { label: "Response Rate", value: apps.filter((a) => a.status === "interviewing" || a.status === "offer").length, total: apps.filter((a) => a.status !== "draft").length, icon: TrendingUp, color: "text-purple-600 bg-purple-100" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border/80 bg-card/60 p-3.5">
              <div className="flex items-center gap-2.5">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.color}`}>
                  <s.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-lg font-bold leading-tight">
                    {s.total !== undefined ? (
                      s.total > 0 ? `${Math.round((s.value / s.total) * 100)}%` : "—"
                    ) : s.value}
                  </p>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && apps.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No applications yet. Browse jobs and apply to track them here.
          </p>
        )}
        <div className="ml-auto">
          <Button asChild variant="default" size="sm" className="rounded-xl">
            <Link href="/applications/auto">
              <Sparkles className="mr-1.5 h-4 w-4" />
              Auto-Apply
            </Link>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : apps.length === 0 ? null : (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* List */}
          <div className={`space-y-2 ${selected ? "hidden lg:block lg:w-1/2" : "w-full"}`}>
            {apps.map((app) => {
              const cfg = statusConfig[app.status] || statusConfig.draft;
              return (
                <div
                  key={app.id}
                  className={`cursor-pointer rounded-xl border p-4 transition-all hover:border-primary/40 hover:shadow-sm ${
                    selected?.id === app.id ? "border-primary/40 bg-primary/5" : "border-border bg-card"
                  }`}
                  onClick={() => setSelected(app)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-medium text-foreground">
                        {app.job?.title || "Unknown Position"}
                      </h3>
                      <p className="truncate text-sm text-muted-foreground">
                        {app.job?.company_name || "Unknown Company"}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${cfg.color}`}>
                          {cfg.icon}
                          {cfg.label}
                        </span>
                        {app.match_score != null && (
                          <span className={`font-bold ${
                            app.match_score >= 70 ? "text-green-600" : app.match_score >= 40 ? "text-amber-600" : "text-muted-foreground"
                          }`}>
                            {app.match_score}%
                          </span>
                        )}
                        {app.applied_at && (
                          <span>{new Date(app.applied_at).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detail */}
          {selected && (
            <div className="w-full lg:w-1/2">
              <div className="sticky top-20 rounded-xl border border-border bg-card p-5">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{selected.job?.title || "Unknown Position"}</h2>
                    <p className="text-muted-foreground">{selected.job?.company_name}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelected(null)}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                </div>

                {selected.job?.application_url && (
                  <Button variant="outline" size="sm" className="mb-4" onClick={() => window.open(selected.job?.application_url ?? "", "_blank")}>
                    <ExternalLink className="mr-1.5 h-4 w-4" /> View Job Posting
                  </Button>
                )}

                {/* Status */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Status</label>
                  <div className="flex flex-wrap gap-1.5">
                    {statusOptions.map((s) => {
                      const cfg = statusConfig[s];
                      const isActive = selected.status === s;
                      return (
                        <button
                          key={s}
                          onClick={() => handleStatusChange(selected.id, s)}
                          disabled={updating === selected.id}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                            isActive ? `${cfg.color} ring-1 ring-ring` : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          {cfg.icon}
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selected.match_score != null && (
                  <div className="mb-4 flex items-center gap-2 rounded-xl bg-primary/5 px-3 py-2 border border-primary/10">
                    <span className="text-xs font-medium text-muted-foreground">Match Score:</span>
                    <span className={`text-lg font-bold ${
                      selected.match_score >= 70 ? "text-green-600" : selected.match_score >= 40 ? "text-amber-600" : "text-muted-foreground"
                    }`}>{selected.match_score}%</span>
                  </div>
                )}

                {/* Interview Stages */}
                <div className="mb-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Interview Stages
                    </h3>
                    <button
                      onClick={() => setAddingStage(!addingStage)}
                      className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {addingStage ? "Cancel" : "Add"}
                    </button>
                  </div>

                  {addingStage && (
                    <div className="mb-3 rounded-xl border border-border bg-muted/30 p-3 space-y-2">
                      <Input
                        placeholder="Stage name (e.g. Phone Screen, Technical, Onsite)"
                        value={stageForm.stage_name}
                        onChange={(e) => setStageForm((p) => ({ ...p, stage_name: e.target.value }))}
                        className="h-8 text-xs rounded-lg"
                      />
                      <Input
                        type="datetime-local"
                        value={stageForm.scheduled_at}
                        onChange={(e) => setStageForm((p) => ({ ...p, scheduled_at: e.target.value }))}
                        className="h-8 text-xs rounded-lg"
                      />
                      <Textarea
                        placeholder="Notes..."
                        value={stageForm.notes}
                        onChange={(e) => setStageForm((p) => ({ ...p, notes: e.target.value }))}
                        className="min-h-[60px] text-xs rounded-lg"
                      />
                      <Textarea
                        placeholder="Prep materials..."
                        value={stageForm.prep_materials}
                        onChange={(e) => setStageForm((p) => ({ ...p, prep_materials: e.target.value }))}
                        className="min-h-[60px] text-xs rounded-lg"
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" className="h-7 text-xs rounded-lg" onClick={() => setAddingStage(false)}>Cancel</Button>
                        <Button variant="default" size="sm" className="h-7 text-xs rounded-lg" onClick={handleAddStage}>Save</Button>
                      </div>
                    </div>
                  )}

                  {stagesLoading ? (
                    <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  ) : stages.length === 0 ? (
                    <p className="text-xs text-muted-foreground/60 italic">No interview stages yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {stages.map((stage) => (
                        <div key={stage.id} className="rounded-lg border border-border bg-card p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{stage.stage_name}</span>
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                  stage.status === "completed" ? "bg-green-100 text-green-700" :
                                  stage.status === "cancelled" ? "bg-red-100 text-red-700" :
                                  stage.status === "no_show" ? "bg-orange-100 text-orange-700" :
                                  "bg-blue-100 text-blue-700"
                                }`}>{stage.status}</span>
                              </div>
                              {stage.scheduled_at && (
                                <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <Calendar className="h-3 w-3" />
                                  {new Date(stage.scheduled_at).toLocaleString()}
                                </p>
                              )}
                              {stage.notes && <p className="mt-1 text-[11px] text-muted-foreground">{stage.notes}</p>}
                              {stage.prep_materials && <p className="mt-1 text-[11px] text-muted-foreground/70 italic">{stage.prep_materials}</p>}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => handleStageStatusToggle(stage)}
                                className={`rounded p-1 transition-colors ${
                                  stage.status === "completed" ? "text-green-600 hover:bg-green-100" : "text-muted-foreground hover:bg-muted"
                                }`}
                                title={stage.status === "completed" ? "Mark pending" : "Mark completed"}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteStage(stage)}
                                className="rounded p-1 text-muted-foreground hover:bg-red-100 hover:text-red-600 transition-colors"
                                title="Delete stage"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Separator className="mb-4" />

                {selected.cover_letter && (
                  <div className="mb-4">
                    <h3 className="mb-2 text-xs font-medium text-muted-foreground">Cover Letter</h3>
                    <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                      {selected.cover_letter}
                    </div>
                  </div>
                )}

                {selected.notes && (
                  <div>
                    <h3 className="mb-2 text-xs font-medium text-muted-foreground">Notes</h3>
                    <p className="text-sm text-muted-foreground">{selected.notes}</p>
                  </div>
                )}

                {selected.applied_at && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Applied on {new Date(selected.applied_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
