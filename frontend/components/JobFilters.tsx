"use client";

import { SlidersHorizontal, X, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export type JobFilterValues = {
  q: string;
  remote: boolean | null;
  location: string;
  employment_type: string[];
  experience_level: string;
  salary_min: string;
  salary_max: string;
  posted_within: string;
  sort: string;
  source: string;
};

const DEFAULT_FILTERS: JobFilterValues = {
  q: "",
  remote: null,
  location: "",
  employment_type: [],
  experience_level: "",
  salary_min: "",
  salary_max: "",
  posted_within: "",
  sort: "",
  source: "",
};

interface JobFiltersProps {
  filters: JobFilterValues;
  onChange: (filters: JobFilterValues) => void;
  onReset: () => void;
}

export { DEFAULT_FILTERS };

const EMPLOYMENT_TYPES = [
  { value: "full-time", label: "Full-time" },
  { value: "part-time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
  { value: "temporary", label: "Temporary" },
];

const EXPERIENCE_LEVELS = [
  { value: "", label: "Any" },
  { value: "entry", label: "Entry" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead" },
];

const POSTED_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "1d", label: "Past 24h" },
  { value: "7d", label: "Past 7 days" },
  { value: "14d", label: "Past 14 days" },
  { value: "30d", label: "Past 30 days" },
];

const SORT_OPTIONS = [
  { value: "", label: "Newest" },
  { value: "salary", label: "Highest Salary" },
];

const SOURCES = [
  { value: "", label: "All Sources" },
  { value: "arbeitnow", label: "Arbeitnow" },
  { value: "jooble", label: "Jooble" },
  { value: "adzuna", label: "Adzuna" },
  { value: "rss", label: "RSS Feeds" },
];

export default function JobFilters({ filters, onChange, onReset }: JobFiltersProps) {
  const hasFilters = filters.remote !== null || filters.location || filters.employment_type.length > 0 ||
    filters.experience_level || filters.salary_min || filters.salary_max || filters.posted_within || filters.source;

  const toggleEmploymentType = (value: string) => {
    const current = filters.employment_type;
    const next = current.includes(value)
      ? current.filter((t) => t !== value)
      : [...current, value];
    onChange({ ...filters, employment_type: next });
  };

  const remoteCount = filters.employment_type.length +
    (filters.experience_level ? 1 : 0) +
    (filters.remote !== null ? 1 : 0) +
    (filters.posted_within ? 1 : 0) +
    (filters.source ? 1 : 0) +
    (filters.salary_min || filters.salary_max ? 1 : 0) +
    (filters.location ? 1 : 0);

  return (
    <div className="rounded-2xl border border-border/80 bg-card/60 backdrop-blur-md p-5 space-y-5 shadow-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground/80" />
          <span className="text-sm font-semibold tracking-tight text-foreground">Filters</span>
          {remoteCount > 0 && (
            <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px] font-medium border-0 px-2 py-0.5 rounded-full">{remoteCount}</Badge>
          )}
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={onReset}>
            <X className="mr-1 h-3.5 w-3.5" />Reset
          </Button>
        )}
      </div>

      <Separator className="bg-border/60" />

      {/* Remote toggle - Segmented Control */}
      <div className="space-y-2">
        <label className="text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase block">Remote</label>
        <div className="flex rounded-lg bg-muted p-0.5 w-full">
          {[
            { value: null, label: "Any" },
            { value: true, label: "Remote" },
            { value: false, label: "On-site" }
          ].map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onChange({ ...filters, remote: opt.value })}
              className={`flex-1 rounded-[6px] py-1 text-xs font-medium transition-all ${
                filters.remote === opt.value
                  ? "bg-background text-foreground shadow-xs border border-border/40"
                  : "text-muted-foreground hover:text-foreground bg-transparent border border-transparent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Location */}
      <div className="space-y-2">
        <label className="text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase block">Location</label>
        <div className="relative">
          <MapPin className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/80" />
          <Input
            placeholder="City or region..."
            value={filters.location}
            onChange={(e) => onChange({ ...filters, location: e.target.value })}
            className="h-9 pl-8 text-xs rounded-lg"
          />
        </div>
      </div>

      {/* Employment type */}
      <div className="space-y-2">
        <label className="text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase block">Employment Type</label>
        <div className="flex flex-wrap gap-1.5">
          {EMPLOYMENT_TYPES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggleEmploymentType(opt.value)}
              className={`rounded-full border px-3 py-1 text-xs transition-all duration-150 ${
                filters.employment_type.includes(opt.value)
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border bg-background/50 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Experience level */}
      <div className="space-y-2">
        <label className="text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase block">Experience</label>
        <div className="flex flex-wrap gap-1.5">
          {EXPERIENCE_LEVELS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...filters, experience_level: opt.value })}
              className={`rounded-full border px-3 py-1 text-xs transition-all duration-150 ${
                filters.experience_level === opt.value
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border bg-background/50 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Salary range */}
      <div className="space-y-2">
        <label className="text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase block">Salary Range</label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/60">$</span>
            <Input
              placeholder="Min"
              type="number"
              value={filters.salary_min}
              onChange={(e) => onChange({ ...filters, salary_min: e.target.value })}
              className="h-9 pl-5 text-xs rounded-lg"
            />
          </div>
          <span className="text-xs text-muted-foreground/60">—</span>
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/60">$</span>
            <Input
              placeholder="Max"
              type="number"
              value={filters.salary_max}
              onChange={(e) => onChange({ ...filters, salary_max: e.target.value })}
              className="h-9 pl-5 text-xs rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* Posted within */}
      <div className="space-y-2">
        <label className="text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase block">Posted</label>
        <div className="flex flex-wrap gap-1.5">
          {POSTED_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...filters, posted_within: opt.value })}
              className={`rounded-full border px-3 py-1 text-xs transition-all duration-150 ${
                filters.posted_within === opt.value
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border bg-background/50 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Source */}
      <div className="space-y-2">
        <label className="text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase block">Source</label>
        <div className="flex flex-wrap gap-1.5">
          {SOURCES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...filters, source: opt.value })}
              className={`rounded-full border px-3 py-1 text-xs transition-all duration-150 ${
                filters.source === opt.value
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border bg-background/50 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sort - Segmented Control */}
      <div className="space-y-2">
        <label className="text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase block">Sort By</label>
        <div className="flex rounded-lg bg-muted p-0.5 w-full">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...filters, sort: opt.value })}
              className={`flex-1 rounded-[6px] py-1.5 text-xs font-medium transition-all ${
                filters.sort === opt.value
                  ? "bg-background text-foreground shadow-xs border border-border/40"
                  : "text-muted-foreground hover:text-foreground bg-transparent border border-transparent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
