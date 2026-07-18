/* eslint-disable @next/next/no-img-element */
"use client";

import { Bookmark, BookmarkCheck, ExternalLink, MapPin, Briefcase, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Job } from "@/lib/api";

interface JobCardProps {
  job: Job;
  saved?: boolean;
  matchScore?: number | null;
  onSave?: (id: string) => void;
  onUnsave?: (id: string) => void;
  onSelect?: (job: Job) => void;
}

export default function JobCard({ job, saved, matchScore, onSave, onUnsave, onSelect }: JobCardProps) {
  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (saved) onUnsave?.(job.id);
    else onSave?.(job.id);
  };

  const timeAgo = job.posted_at ? (() => { const d = new Date(job.posted_at); return isNaN(d.getTime()) ? null : formatTimeAgo(d); })() : null;

  return (
    <div
      className="group cursor-pointer rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-sm"
      onClick={() => onSelect?.(job)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            {job.company_logo ? (
              <img src={job.company_logo} alt={job.company_name} className="h-8 w-8 rounded object-contain"
                onError={(e) => { const img = e.target as HTMLImageElement; img.style.display = "none"; if (img.parentElement) img.parentElement.textContent = job.company_name[0] ?? "?"; }} />
            ) : (
              <Building2 className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium text-foreground">{job.title}</h3>
            <p className="truncate text-sm text-muted-foreground">{job.company_name}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {job.is_remote && <Badge variant="secondary" className="text-[10px]">Remote</Badge>}
              {job.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{job.location}</span>}
              {job.employment_type && <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" />{job.employment_type}</span>}
              {job.experience_level && <Badge variant="outline" className="text-[10px]">{job.experience_level}</Badge>}
              {job.salary_min != null && (
                <span className="text-muted-foreground/60">
                  {job.currency || "$"}{job.salary_min.toLocaleString()}{job.salary_max ? ` - ${job.currency || "$"}${job.salary_max.toLocaleString()}` : "+"}
                </span>
              )}
              {timeAgo && <span className="text-muted-foreground/60">{timeAgo}</span>}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {matchScore !== undefined && matchScore !== null && (
            <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${
              matchScore >= 70 ? "bg-green-100 text-green-700" :
              matchScore >= 40 ? "bg-amber-100 text-amber-700" :
              "bg-muted text-muted-foreground"
            }`}>
              {matchScore}
            </div>
          )}
          {onSave && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSave}>
              {saved ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => {
            e.stopPropagation();
            if (job.application_url) window.open(job.application_url, "_blank", "noopener,noreferrer");
          }}>
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
