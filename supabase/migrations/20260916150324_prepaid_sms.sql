begin;
create table if not exists app_private.sms_payments (
 id uuid primary key default gen_random_uuid(),
 org_id bigint not null references app_private.organizations(id),
 user_id text not null references app_private.users(id),
 from_number text not null,
 to_number text not null,
 amount_cents integer not null check(amount_cents>0),
 state text not null default 'charging' check(state in ('charging','debited','sending','sent','refund_pending','refunded','failed')),
 provider_sid text unique,
 next_attempt_at timestamptz not null default now()+interval '2 minutes',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table app_private.sms_payments enable row level security;
revoke all on app_private.sms_payments from public,anon,authenticated;
create index if not exists sms_payments_recovery on app_private.sms_payments(next_attempt_at) where state in ('charging','debited','refund_pending');
alter table app_private.usage_charges add column if not exists prepaid_cents integer not null default 0 check(prepaid_cents>=0);
commit;
