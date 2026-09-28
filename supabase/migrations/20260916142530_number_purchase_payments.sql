begin;
alter table app_private.number_requests
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','processing','paid','failed','refunding','refunded')),
  add column if not exists payment_key uuid not null default gen_random_uuid(),
  add column if not exists customer_email text not null default '',
  add column if not exists paid_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists next_payment_attempt_at timestamptz not null default now(),
  add column if not exists payment_error text;
create index if not exists number_payments_due on app_private.number_requests(next_payment_attempt_at)
  where payment_status in ('processing','refunding') or (payment_status='paid' and email_status <> 'sent');
-- Existing requests remain unpaid. Only an explicit Pay action authorizes a debit.
commit;
