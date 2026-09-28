begin;
alter table app_private.number_requests add column if not exists cancel_requested boolean not null default false;
commit;
