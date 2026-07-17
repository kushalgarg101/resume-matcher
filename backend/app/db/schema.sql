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
