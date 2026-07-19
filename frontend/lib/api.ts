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
  const token = data?.session?.access_token;
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

// ── Profile ─────────────────────────────────────────────────────────────────

export interface Experience {
  company: string;
  role: string;
  start_date?: string | null;
  end_date?: string | null;
  description?: string | null;
  current?: boolean;
}

export interface Education {
  institution: string;
  degree?: string | null;
  field?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

export interface Project {
  name: string;
  description?: string | null;
  technologies?: string[];
  url?: string | null;
}

export interface Certification {
  name: string;
  issuer?: string | null;
  date?: string | null;
  url?: string | null;
}

export interface UserProfile {
  id: string;
  user_id: string;
  full_name?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedin_url?: string | null;
  portfolio_url?: string | null;
  skills: string[];
  experience: Experience[];
  education: Education[];
  projects: Project[];
  certifications: Certification[];
  summary?: string | null;
  preferred_roles: string[];
  preferred_locations: string[];
  is_open_to_work: boolean;
  is_complete: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function getProfile(): Promise<UserProfile> {
  const res = await fetch(apiUrl("/api/profile"), {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, `Fetch profile failed (${res.status})`);
  return res.json();
}

export async function updateProfile(data: Partial<UserProfile>): Promise<UserProfile> {
  const res = await fetch(apiUrl("/api/profile"), {
    method: "PUT",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new ApiError(res.status, `Update profile failed (${res.status})`);
  return res.json();
}

// ── Chat ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string | null;
}

export interface ChatConversation {
  id: string;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ChatResponse {
  conversation_id: string;
  message: ChatMessage;
  profile?: UserProfile | null;
  profile_complete: boolean;
}

export interface GetConversationResponse {
  conversation: ChatConversation | null;
  messages: ChatMessage[];
}

export async function getConversation(): Promise<GetConversationResponse> {
  const res = await fetch(apiUrl("/api/chat/conversation"), {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, `Fetch conversation failed (${res.status})`);
  return res.json();
}

export async function sendChatMessage(message: string, conversationId?: string): Promise<ChatResponse> {
  const res = await fetch(apiUrl("/api/chat"), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversation_id: conversationId || null }),
  });
  if (!res.ok) throw new ApiError(res.status, `Chat failed (${res.status})`);
  return res.json();
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  source: string;
  title: string;
  company_name: string;
  company_logo?: string | null;
  location?: string | null;
  description?: string | null;
  requirements: string[];
  experience_level?: string | null;
  employment_type?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  currency?: string | null;
  application_url?: string | null;
  is_remote: boolean;
  posted_at?: string | null;
  created_at?: string | null;
}

export interface JobListResponse {
  jobs: Job[];
  total: number;
  page: number;
  per_page: number;
}

export async function listJobs(params?: {
  q?: string;
  source?: string;
  remote?: boolean;
  location?: string;
  employment_type?: string;
  experience_level?: string;
  salary_min?: number;
  salary_max?: number;
  posted_within?: string;
  sort?: string;
  page?: number;
  per_page?: number;
}): Promise<JobListResponse> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.source) search.set("source", params.source);
  if (params?.remote !== undefined) search.set("remote", String(params.remote));
  if (params?.location) search.set("location", params.location);
  if (params?.employment_type) search.set("employment_type", params.employment_type);
  if (params?.experience_level) search.set("experience_level", params.experience_level);
  if (params?.salary_min !== undefined) search.set("salary_min", String(params.salary_min));
  if (params?.salary_max !== undefined) search.set("salary_max", String(params.salary_max));
  if (params?.posted_within) search.set("posted_within", params.posted_within);
  if (params?.sort) search.set("sort", params.sort);
  if (params?.page) search.set("page", String(params.page));
  if (params?.per_page) search.set("per_page", String(params.per_page));
  const qs = search.toString();
  const url = apiUrl(`/api/jobs${qs ? `?${qs}` : ""}`);
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) throw new ApiError(res.status, `List jobs failed (${res.status})`);
  return res.json();
}

export async function getJob(id: string): Promise<Job> {
  const res = await fetch(apiUrl(`/api/jobs/${id}`), {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, `Get job failed (${res.status})`);
  return res.json();
}

export async function listSavedJobs(): Promise<Job[]> {
  const res = await fetch(apiUrl("/api/jobs/saved"), {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, `List saved jobs failed (${res.status})`);
  return res.json();
}

export async function saveJob(jobId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/jobs/${jobId}/save`), {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, `Save job failed (${res.status})`);
}

export async function unsaveJob(jobId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/jobs/${jobId}/save`), {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, `Unsave job failed (${res.status})`);
}

export async function syncJobs(): Promise<void> {
  const res = await fetch(apiUrl("/api/jobs/sync"), {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, `Sync jobs failed (${res.status})`);
}

// ── Match ───────────────────────────────────────────────────────────────────

export interface MatchBreakdown {
  skills: number;
  role: number;
  location: number;
  experience: number;
}

export interface MatchDetails {
  matched_skills: string[];
  total_skills: number;
  job_title: string;
  is_remote: boolean;
  experience_count: number;
}

export interface JobMatchResult {
  score: number;
  breakdown: MatchBreakdown;
  details: MatchDetails;
}

export async function getJobMatch(jobId: string): Promise<JobMatchResult> {
  const res = await fetch(apiUrl(`/api/jobs/${jobId}/match`), {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, `Match failed (${res.status})`);
  return res.json();
}

export interface BatchMatchResponse {
  matches: Record<string, JobMatchResult>;
}

export async function batchMatchJobs(jobIds: string[]): Promise<BatchMatchResponse> {
  const res = await fetch(apiUrl("/api/jobs/match-batch"), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ job_ids: jobIds }),
  });
  if (!res.ok) throw new ApiError(res.status, `Batch match failed (${res.status})`);
  return res.json();
}

// ── Cover Letter ────────────────────────────────────────────────────────────

export async function generateCoverLetter(jobId: string): Promise<string> {
  const res = await fetch(apiUrl("/api/cover-letter"), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId }),
  });
  if (!res.ok) throw new ApiError(res.status, `Cover letter failed (${res.status})`);
  const data = await res.json();
  return data.cover_letter;
}

// ── Applications ────────────────────────────────────────────────────────────

export interface Application {
  id: string;
  job_id: string;
  status: "draft" | "applied" | "interviewing" | "offer" | "rejected" | "withdrawn";
  cover_letter?: string | null;
  notes?: string | null;
  tailored_resume_url?: string | null;
  email_thread_id?: string | null;
  match_score?: number | null;
  applied_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  job?: Job | null;
}

export async function listApplications(): Promise<Application[]> {
  const res = await fetch(apiUrl("/api/applications"), {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, `List applications failed (${res.status})`);
  return res.json();
}

export async function createApplication(jobId: string, coverLetter?: string, notes?: string): Promise<Application> {
  const res = await fetch(apiUrl("/api/applications"), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId, cover_letter: coverLetter || null, notes: notes || null }),
  });
  if (!res.ok) {
    if (res.status === 409) throw new ApiError(409, "Already applied to this job.");
    throw new ApiError(res.status, `Apply failed (${res.status})`);
  }
  return res.json();
}

export async function updateApplication(id: string, data: Partial<Application>): Promise<Application> {
  const res = await fetch(apiUrl(`/api/applications/${id}`), {
    method: "PATCH",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new ApiError(res.status, `Update application failed (${res.status})`);
  return res.json();
}

// ── Planner ─────────────────────────────────────────────────────────────────

export interface SearchPlan {
  roles: string[];
  location?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  remote?: boolean | null;
  employment_type?: string | null;
  experience_level?: string | null;
  max_applications: number;
}

export interface PlannerResponse {
  search_plan: SearchPlan;
  suggestions: string[];
}

export async function createPlan(query: string): Promise<PlannerResponse> {
  const res = await fetch(apiUrl("/api/planner/plan"), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new ApiError(res.status, `Planner failed (${res.status})`);
  return res.json();
}

// ── Resume Tailor ───────────────────────────────────────────────────────────

export interface OptimizedResume {
  id: string;
  job_id: string;
  storage_path: string;
  summary?: string | null;
  skills: string[];
  created_at?: string | null;
}

export interface TailorResumeResponse {
  optimized_resume: OptimizedResume;
  tailored_profile: Record<string, unknown>;
}

export async function tailorResume(jobId: string): Promise<TailorResumeResponse> {
  const res = await fetch(apiUrl("/api/resume/tailor"), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId }),
  });
  if (!res.ok) throw new ApiError(res.status, `Resume tailor failed (${res.status})`);
  return res.json();
}

export async function getTailoredResume(jobId: string): Promise<OptimizedResume | null> {
  const res = await fetch(apiUrl(`/api/resume/tailor/${jobId}`), {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new ApiError(res.status, `Get tailored resume failed (${res.status})`);
  }
  const data = await res.json();
  return data as OptimizedResume | null;
}

// ── Email Monitoring ────────────────────────────────────────────────────────

export interface EmailConfig {
  provider: string;
  imap_host?: string | null;
  imap_port?: number | null;
  email_address?: string | null;
  app_password?: string | null;
  use_ssl: boolean;
  last_sync_at?: string | null;
  enabled: boolean;
}

export interface EmailSyncResult {
  processed: number;
  matched: number;
  updated_applications: number;
  errors: string[];
}

export async function getEmailConfig(): Promise<EmailConfig | null> {
  const res = await fetch(apiUrl("/api/email/config"), {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new ApiError(res.status, `Get email config failed (${res.status})`);
  }
  const data = await res.json();
  return data as EmailConfig | null;
}

export async function updateEmailConfig(data: Partial<EmailConfig>): Promise<EmailConfig> {
  const res = await fetch(apiUrl("/api/email/config"), {
    method: "PUT",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new ApiError(res.status, `Update email config failed (${res.status})`);
  return res.json();
}

export async function syncEmails(): Promise<EmailSyncResult> {
  const res = await fetch(apiUrl("/api/email/sync"), {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, `Email sync failed (${res.status})`);
  return res.json();
}

// ── Interview Stages ─────────────────────────────────────────────────────────

export interface InterviewStage {
  id: string;
  application_id: string;
  stage_name: string;
  scheduled_at?: string | null;
  status: string;
  notes?: string | null;
  prep_materials?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CreateInterviewStage {
  application_id: string;
  stage_name: string;
  scheduled_at?: string | null;
  notes?: string | null;
  prep_materials?: string | null;
}

export interface UpdateInterviewStage {
  stage_name?: string | null;
  scheduled_at?: string | null;
  status?: string | null;
  notes?: string | null;
  prep_materials?: string | null;
}

export async function listInterviewStages(applicationId: string): Promise<InterviewStage[]> {
  const res = await fetch(apiUrl(`/api/applications/${applicationId}/stages`), {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, `Failed to list stages (${res.status})`);
  return res.json();
}

export async function createInterviewStage(data: CreateInterviewStage): Promise<InterviewStage> {
  const res = await fetch(apiUrl(`/api/applications/${data.application_id}/stages`), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new ApiError(res.status, `Failed to create stage (${res.status})`);
  return res.json();
}

export async function updateInterviewStage(
  applicationId: string,
  stageId: string,
  data: UpdateInterviewStage
): Promise<InterviewStage> {
  const res = await fetch(apiUrl(`/api/applications/${applicationId}/stages/${stageId}`), {
    method: "PATCH",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new ApiError(res.status, `Failed to update stage (${res.status})`);
  return res.json();
}

export async function deleteInterviewStage(applicationId: string, stageId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/applications/${applicationId}/stages/${stageId}`), {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new ApiError(res.status, `Failed to delete stage (${res.status})`);
}
