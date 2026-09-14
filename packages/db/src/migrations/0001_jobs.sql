create table if not exists jobs (
  id text primary key,
  status text not null default 'pending',
  input jsonb not null,
  plan jsonb,
  completed_stages jsonb not null default '[]',
  video_path text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
