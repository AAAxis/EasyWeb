-- Softphones (Zoiper) registered to our Twilio SIP domain, and whose they are.
-- Twilio authenticates the SIP credentials; this row is what authorizes the
-- authenticated username to place calls as one user, billed to one wallet,
-- presenting one of that user's numbers.
begin;
create table if not exists app_private.sip_endpoints (
 id bigint generated always as identity primary key,
 username text not null,
 sip_domain text not null,
 org_id bigint not null references app_private.organizations(id),
 user_id text not null references app_private.users(id),
 caller_id text not null check(caller_id ~ '^\+[1-9][0-9]{7,14}$'),
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(sip_domain, username)
);
alter table app_private.sip_endpoints enable row level security;
revoke all on app_private.sip_endpoints from public,anon,authenticated;
commit;
