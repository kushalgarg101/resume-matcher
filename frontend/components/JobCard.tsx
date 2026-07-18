/* eslint-disable @next/next/no-img-element */
"use client";

import { Bookmark, BookmarkCheck, ExternalLink, MapPin, Briefcase, Building2, Calendar } from "lucide-react";
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
      className="group cursor-pointer rounded-2xl border border-border/80 bg-card/65 p-4.5 transition-all duration-300 hover:border-primary/40 hover:bg-card hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
      onClick={() => onSelect?.(job)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-muted to-muted/80 text-muted-foreground shadow-xs">
            {job.company_logo ? (
              <img src={job.company_logo} alt={job.company_name} className="h-9 w-9 rounded-lg object-contain"
                onError={(e) => { const img = e.target as HTMLImageElement; img.style.display = "none"; if (img.parentElement) { img.parentElement.textContent = job.company_name[0] ?? "?"; img.parentElement.className = "flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary font-semibold text-lg uppercase"; } }} />
            ) : (
              <Building2 className="h-5 w-5 text-muted-foreground/80" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors duration-200">{job.title}</h3>
            <p className="truncate text-xs font-medium text-muted-foreground mt-0.5">{job.company_name}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground/85">
              {job.is_remote && (
                <Badge variant="secondary" className="bg-primary/10 text-primary border-0 rounded-full font-medium px-2 py-0.5 text-[10px]">
                  Remote
                </Badge>
              )}
              {job.experience_level && (
                <Badge variant="outline" className="border-border/80 text-muted-foreground rounded-full px-2 py-0.5 text-[10px] uppercase font-semibold tracking-wider">
                  {job.experience_level}
                </Badge>
              )}
              {job.location && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground/75">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground/50" />
                  {job.location}
                </span>
              )}
              {job.employment_type && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground/75">
                  <Briefcase className="h-3.5 w-3.5 text-muted-foreground/50" />
                  {job.employment_type}
                </span>
              )}
              {job.salary_min != null && (
                <span className="text-[11px] font-semibold text-foreground/80">
                  {job.currency || "$"}{job.salary_min.toLocaleString()}{job.salary_max ? ` - ${job.currency || "$"}${job.salary_max.toLocaleString()}` : "+"}
                </span>
              )}
              {timeAgo && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground/60">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground/40" />
                  {timeAgo}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {matchScore !== undefined && matchScore !== null && (
            <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ring-2 ring-offset-2 ring-offset-background ${
              matchScore >= 70 ? "bg-green-50 text-green-600 ring-green-500/20" :
              matchScore >= 40 ? "bg-amber-50 text-amber-600 ring-amber-500/20" :
              "bg-muted/80 text-muted-foreground ring-muted"
            }`}>
              {matchScore}
            </div>
          )}
          {onSave && (
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted/80 rounded-lg" onClick={handleSave}>
              {saved ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4 text-muted-foreground" />}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted/80 rounded-lg" onClick={(e) => {
            e.stopPropagation();
            if (job.application_url) window.open(job.application_url, "_blank", "noopener,noreferrer");
          }}>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
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
