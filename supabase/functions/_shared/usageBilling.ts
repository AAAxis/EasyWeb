import { sql } from './db.ts';

export async function queueUsage(kind: 'call' | 'sms', sid: string, accountSid: string, orgId: number, userId: string) {
  const prefix = kind === 'call' ? 'CA' : 'SM';
  if (!new RegExp(`^${prefix}[a-f0-9]{32}$`, 'i').test(sid) || !/^AC[a-f0-9]{32}$/i.test(accountSid) || !userId) {
    throw new Error('INVALID_USAGE_IDENTITY');
  }
  // The immutable owner is captured before call routing or from the authenticated
  // SMS sender. A callback never selects the workspace's primary-number owner.
  const prepaid = kind === 'sms' ? await sql`select amount_cents from app_private.sms_payments where provider_sid=${sid} and user_id=${userId} and org_id=${orgId} and state='sent'` : [];
  await sql`insert into app_private.usage_charges(kind,provider_sid,provider_account_sid,org_id,user_id,prepaid_cents)
    values(${kind},${sid},${accountSid},${orgId},${userId},${prepaid[0]?.amount_cents ?? 0})
    on conflict(kind,provider_account_sid,provider_sid) do update
      set prepaid_cents=greatest(app_private.usage_charges.prepaid_cents,excluded.prepaid_cents)`;
}
