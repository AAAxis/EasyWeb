import { sql } from './db.ts';
import { HttpError } from './http.ts';

export function smsPhoneKey(phone: string) {
  const digits = String(phone ?? '').replace(/\D/g,'');
  if (!/^\d{7,15}$/.test(digits)) throw new HttpError(400,'Enter a full phone number with country code.','INVALID_NUMBER');
  return digits;
}

export async function smsThreadForPhone(orgId: number, phone: string) {
  const key = smsPhoneKey(phone);
  return await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`sms:${orgId}:${key}`},0))`;
    const [existing] = await tx`select cv.* from app_private.conversations cv
      left join app_private.contacts c on c.id=cv.contact_id
      where cv.org_id=${orgId} and cv.channel in ('sms','in_app')
        and (regexp_replace(cv.subject,'[^0-9]','','g')=${key}
             or regexp_replace(c.phone,'[^0-9]','','g')=${key})
      order by cv.id limit 1 for update of cv`;
    if (existing) {
      const [row] = await tx`update app_private.conversations set channel='sms',status='open' where id=${existing.id} returning *`;
      return row;
    }
    const [contact] = await tx`select id from app_private.contacts where org_id=${orgId}
      and regexp_replace(phone,'[^0-9]','','g')=${key} order by id limit 1`;
    const [row] = await tx`insert into app_private.conversations(org_id,contact_id,channel,subject)
      values(${orgId},${contact?.id ?? null},'sms',${'+'+key}) returning *`;
    return row;
  });
}
