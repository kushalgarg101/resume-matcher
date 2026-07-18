"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft, Briefcase, Send, CheckCircle2, XCircle, Clock, Calendar, Building2, ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { listApplications, updateApplication, Application } from "@/lib/api";

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

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : apps.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          No applications yet. Browse jobs and apply to track them here.
        </div>
      ) : (
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
