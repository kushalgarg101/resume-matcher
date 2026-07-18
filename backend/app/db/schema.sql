-- ============================================================================
-- Resume Matcher — Supabase schema
-- Run this in Supabase Dashboard -> SQL Editor (or via Supabase CLI migration).
-- Free tier: 500 MB DB, RLS enabled by default on new tables.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles: 1:1 with auth.users. Populated by a trigger on new signups.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    email       text,
    created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Allow a user to read only their own profile row.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
    on public.profiles for select
    using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- analyses: one row per resume <-> JD scoring job.
-- status: queued -> processing -> completed | failed
-- result_json holds the LLM output once finished.
-- ---------------------------------------------------------------------------
create table if not exists public.analyses (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references public.profiles (id) on delete cascade,
    filename      text not null,
    jd_text       text not null,
    storage_path  text not null,            -- path inside the resumes bucket
    status        text not null default 'queued'
                    check (status in ('queued', 'processing', 'completed', 'failed')),
    result_json   jsonb,
    error_message text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    completed_at  timestamptz
);

create index if not exists analyses_user_id_idx on public.analyses (user_id);
create index if not exists analyses_status_idx on public.analyses (status);

-- Keep `updated_at` current whenever a row changes (useful for monitoring
-- stuck `processing` rows and for client display).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists analyses_set_updated_at on public.analyses;
create trigger analyses_set_updated_at
    before update on public.analyses
    for each row execute function public.set_updated_at();

alter table public.analyses enable row level security;

-- Users see only their own analyses.
drop policy if exists "analyses_select_own" on public.analyses;
create policy "analyses_select_own"
    on public.analyses for select
    using (auth.uid() = user_id);

-- Users may insert only rows owned by themselves.
drop policy if exists "analyses_insert_own" on public.analyses;
create policy "analyses_insert_own"
    on public.analyses for insert
    with check (auth.uid() = user_id);

-- NOTE: Updates to status/result_json are performed by the WORKER using the
-- service_role key, which bypasses RLS, so no update policy is needed for
-- authenticated users. (We deliberately do NOT grant update to `authenticated`.)

-- ---------------------------------------------------------------------------
-- Auto-create a profile row whenever a new auth user signs up.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.profiles (id, email)
    values (new.id, new.email)
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ============================================================================
-- Phase 1: User profiles + Agent chat
-- ============================================================================

-- ---------------------------------------------------------------------------
-- user_profiles: structured profile extracted from resume + chat refinement
-- 1:1 with auth.users (created on first extraction or upload).
-- ---------------------------------------------------------------------------
create table if not exists public.user_profiles (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users (id) on delete cascade,
    full_name         text,
    phone             text,
    location          text,
    linkedin_url      text,
    portfolio_url     text,
    skills            jsonb not null default '[]'::jsonb,
    experience        jsonb not null default '[]'::jsonb,
    education         jsonb not null default '[]'::jsonb,
    projects          jsonb not null default '[]'::jsonb,
    certifications    jsonb not null default '[]'::jsonb,
    summary           text,
    preferred_roles   jsonb not null default '[]'::jsonb,
    preferred_locations jsonb not null default '[]'::jsonb,
    is_open_to_work   boolean not null default true,
    is_complete       boolean not null default false,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index if not exists user_profiles_user_id_idx on public.user_profiles (user_id);

alter table public.user_profiles enable row level security;

create policy "user_profiles_select_own"
    on public.user_profiles for select
    using (auth.uid() = user_id);

create policy "user_profiles_insert_own"
    on public.user_profiles for insert
    with check (auth.uid() = user_id);

create policy "user_profiles_update_own"
    on public.user_profiles for update
    using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- chat_conversations: one per active agent session.
-- ---------------------------------------------------------------------------
create table if not exists public.chat_conversations (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    context    jsonb not null default '{}'::jsonb,
    status     text not null default 'active'
                  check (status in ('active', 'completed')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists chat_conversations_user_id_idx on public.chat_conversations (user_id);

alter table public.chat_conversations enable row level security;

create policy "chat_conversations_select_own"
    on public.chat_conversations for select
    using (auth.uid() = user_id);

create policy "chat_conversations_insert_own"
    on public.chat_conversations for insert
    with check (auth.uid() = user_id);

create policy "chat_conversations_update_own"
    on public.chat_conversations for update
    using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- chat_messages: individual turns in a conversation.
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
    id              uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
    role            text not null check (role in ('user', 'assistant')),
    content         text not null,
    created_at      timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

create policy "chat_messages_select_own"
    on public.chat_messages for select
    using (
        exists (
            select 1 from public.chat_conversations
            where id = conversation_id and user_id = auth.uid()
        )
    );

create policy "chat_messages_insert_own"
    on public.chat_messages for insert
    with check (
        exists (
            select 1 from public.chat_conversations
            where id = conversation_id and user_id = auth.uid()
        )
    );

-- ============================================================================
-- Phase 2: Job aggregation
-- ============================================================================

-- ---------------------------------------------------------------------------
-- jobs: normalized job listings fetched from various sources.
-- ---------------------------------------------------------------------------
create table if not exists public.jobs (
    id               uuid primary key default gen_random_uuid(),
    external_id      text,                                       -- id from source
    source           text not null,                               -- 'remoteok', 'weworkremotely', etc.
    title            text not null,
    company_name     text not null,
    company_logo     text,
    location         text,
    description      text,
    requirements     jsonb not null default '[]'::jsonb,
    experience_level text,                                        -- 'entry', 'mid', 'senior', 'lead'
    employment_type  text,                                        -- 'full-time', 'part-time', 'contract'
    salary_min       numeric,
    salary_max       numeric,
    currency         text,
    application_url  text,
    is_remote        boolean not null default false,
    posted_at        timestamptz,
    created_at       timestamptz not null default now()
);

create unique index if not exists jobs_external_source_idx on public.jobs (external_id, source);
create index if not exists jobs_created_at_idx on public.jobs (created_at desc);
create index if not exists jobs_source_idx on public.jobs (source);

alter table public.jobs enable row level security;

create policy "jobs_select_all"
    on public.jobs for select
    using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- user_saved_jobs: bookmarked jobs per user.
-- ---------------------------------------------------------------------------
create table if not exists public.user_saved_jobs (
    id       uuid primary key default gen_random_uuid(),
    user_id  uuid not null references auth.users (id) on delete cascade,
    job_id   uuid not null references public.jobs (id) on delete cascade,
    saved_at timestamptz not null default now(),
    unique (user_id, job_id)
);

alter table public.user_saved_jobs enable row level security;

create policy "user_saved_jobs_select_own"
    on public.user_saved_jobs for select
    using (auth.uid() = user_id);

create policy "user_saved_jobs_insert_own"
    on public.user_saved_jobs for insert
    with check (auth.uid() = user_id);

create policy "user_saved_jobs_delete_own"
    on public.user_saved_jobs for delete
    using (auth.uid() = user_id);

-- ============================================================================
-- Phase 3: Applications + Match
-- ============================================================================

create table if not exists public.applications (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users (id) on delete cascade,
    job_id          uuid not null references public.jobs (id) on delete cascade,
    status          text not null default 'draft'
                      check (status in ('draft', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn')),
    cover_letter    text,
    resume_url      text,
    notes           text,
    applied_at      timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (user_id, job_id)
);

alter table public.applications enable row level security;

create policy "applications_select_own"
    on public.applications for select
    using (auth.uid() = user_id);

create policy "applications_insert_own"
    on public.applications for insert
    with check (auth.uid() = user_id);

create policy "applications_update_own"
    on public.applications for update
    using (auth.uid() = user_id);

create policy "applications_delete_own"
    on public.applications for delete
    using (auth.uid() = user_id);
