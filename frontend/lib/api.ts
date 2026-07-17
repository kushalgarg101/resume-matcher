/**
 * Thin wrapper around the FastAPI backend.
 *
 * Every call attaches the current Supabase session JWT as a Bearer token so the
 * backend's `get_current_user` dependency can verify it and scope DB queries via
 * Row Level Security.
 */
import { supabase } from "./supabase";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!API_BASE) {
  // Surfaced loudly instead of producing `undefined/api/...` requests at runtime.
  console.error(
    "NEXT_PUBLIC_API_BASE_URL is not set. Add it to your Vercel project env."
  );
}

function apiUrl(path: string): string {
  if (!API_BASE) {
    throw new Error(
      "API base URL is not configured (NEXT_PUBLIC_API_BASE_URL)."
    );
  }
  return `${API_BASE}${path}`;
}

export interface MatchResult {
  score: number;
  matched_skills: string[];
  missing_skills: string[];
  rationale: string;
}

export interface Analysis {
  id: string;
  filename: string;
  status: "queued" | "processing" | "completed" | "failed";
  result: MatchResult | null;
  error_message: string | null;
  created_at: string | null;
  completed_at: string | null;
}

/** Error carrying the HTTP status so callers can branch (e.g. on 401). */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function createAnalysis(
  jdText: string,
  resumeFile: File
): Promise<Analysis> {
  const form = new FormData();
  form.append("jd_text", jdText);
  form.append("resume", resumeFile);

  const res = await fetch(apiUrl("/api/analyses"), {
    method: "POST",
    headers: await authHeaders(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // Pydantic validation errors return `detail` as a list of issue objects;
    // flatten it into a readable string so the user sees something useful
    // (e.g. "jd_text: ensure this value has at least 10 characters") instead of
    // "[object Object]".
    let message = `Upload failed (${res.status})`;
    const detail = (err as { detail?: unknown }).detail;
    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      message = detail
        .map((d: { loc?: string[]; msg?: string }) =>
          d.loc && d.msg ? `${d.loc.join(".")}: ${d.msg}` : d.msg ?? ""
        )
        .filter(Boolean)
        .join("; ");
    }
    throw new ApiError(res.status, message || `Upload failed (${res.status})`);
  }
  return res.json();
}

export async function getAnalysis(id: string): Promise<Analysis> {
  const res = await fetch(apiUrl(`/api/analyses/${id}`), {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new ApiError(res.status, `Fetch failed (${res.status})`);
  }
  return res.json();
}

export async function listAnalyses(): Promise<Analysis[]> {
  const res = await fetch(apiUrl("/api/analyses"), {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new ApiError(res.status, `List failed (${res.status})`);
  }
  return res.json();
}
