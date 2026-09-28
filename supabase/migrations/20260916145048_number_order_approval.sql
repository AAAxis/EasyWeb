begin;
alter table app_private.number_requests
  add column if not exists approval_token uuid not null default gen_random_uuid(),
  add column if not exists approval_expires_at timestamptz not null default now()+interval '14 days',
  add column if not exists activation_status text not null default 'idle' check(activation_status in ('idle','processing','active')),
  add column if not exists activation_attempt_at timestamptz;
commit;
