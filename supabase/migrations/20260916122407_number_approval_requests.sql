create table if not exists app_private.number_requests (
  id uuid primary key default gen_random_uuid(),
  org_id bigint not null references app_private.organizations(id),
  user_id text not null references app_private.users(id),
  phone_number text not null check (phone_number ~ '^\+[0-9]{7,15}$'),
  country text not null check (country ~ '^[A-Z]{2}$'),
  monthly_price_cents integer not null check (monthly_price_cents > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  email_status text not null default 'pending' check (email_status in ('pending','sent','failed')),
  email_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists number_requests_pending_unique
  on app_private.number_requests (user_id, phone_number) where status = 'pending';
create index if not exists number_requests_user_idx on app_private.number_requests (user_id, org_id, created_at desc);
alter table app_private.number_requests enable row level security;
revoke all on app_private.number_requests from public, anon, authenticated;
