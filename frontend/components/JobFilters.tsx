"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filters</span>
          {remoteCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">{remoteCount}</Badge>
          )}
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={onReset}>
            <X className="mr-1 h-3 w-3" />Reset
          </Button>
        )}
      </div>

      {/* Remote toggle */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Remote</label>
        <div className="flex gap-1">
          {[{ value: null, label: "Any" }, { value: true, label: "Remote" }, { value: false, label: "On-site" }].map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onChange({ ...filters, remote: opt.value })}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                filters.remote === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Location */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Location</label>
        <Input
          placeholder="City or region..."
          value={filters.location}
          onChange={(e) => onChange({ ...filters, location: e.target.value })}
          className="h-8 text-xs"
        />
      </div>

      {/* Employment type */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Employment Type</label>
        <div className="flex flex-wrap gap-1">
          {EMPLOYMENT_TYPES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggleEmploymentType(opt.value)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                filters.employment_type.includes(opt.value)
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Experience level */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Experience</label>
        <div className="flex flex-wrap gap-1">
          {EXPERIENCE_LEVELS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...filters, experience_level: opt.value })}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                filters.experience_level === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Salary range */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Salary Range</label>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Min"
            type="number"
            value={filters.salary_min}
            onChange={(e) => onChange({ ...filters, salary_min: e.target.value })}
            className="h-8 text-xs"
          />
          <span className="text-xs text-muted-foreground">-</span>
          <Input
            placeholder="Max"
            type="number"
            value={filters.salary_max}
            onChange={(e) => onChange({ ...filters, salary_max: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
      </div>

      {/* Posted within */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Posted</label>
        <div className="flex flex-wrap gap-1">
          {POSTED_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...filters, posted_within: opt.value })}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                filters.posted_within === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Source */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Source</label>
        <div className="flex flex-wrap gap-1">
          {SOURCES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...filters, source: opt.value })}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                filters.source === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sort */}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Sort By</label>
        <div className="flex flex-wrap gap-1">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...filters, sort: opt.value })}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                filters.sort === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
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
