create table if not exists public.cv_sync_snapshots (
  scope text primary key,
  source text not null default 'manual_import',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

create index if not exists idx_cv_sync_snapshots_updated_at
  on public.cv_sync_snapshots (updated_at desc);
