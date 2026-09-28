import { processNumberRental } from './numberRentals.ts';
import { sql } from './db.ts';
import { HttpError } from './http.ts';
import { credsFor } from './providers/twilioAccount.ts';
import { release } from './providers/numbers.ts';

export async function releaseOwnedNumber(ctx:{uid:string;orgId:number},id:number) {
  const [row]=await sql`select * from app_private.phone_numbers where id=${id} and org_id=${ctx.orgId} and user_id=${ctx.uid}`;
  if (!row) throw new HttpError(404,'Number not found.','NOT_FOUND');
  const rental = await sql.begin(async(tx) => {
    const [tracked] = await tx`select * from app_private.number_rentals where provider_sid=${row.provider_sid} for update`;
    if (!tracked || tracked.state==='released') return null;
    if (tracked.user_id!==ctx.uid || Number(tracked.org_id)!==ctx.orgId) throw new HttpError(409,'Number ownership changed.','NUMBER_OWNERSHIP_CHANGED');
    if (tracked.state==='charging' || (tracked.lease_until && new Date(tracked.lease_until).getTime()>Date.now()))
      throw new HttpError(409,'Number payment or release is processing. Please try again shortly.','RENTAL_PROCESSING');
    const [claimed] = await tx`update app_private.number_rentals set state='releasing',lease_token=gen_random_uuid(),
      lease_until=now()+interval '5 minutes',next_attempt_at=now() where id=${tracked.id} returning *`;
    return claimed;
  });
  if (rental) {
    await processNumberRental(rental);
    return {removed:true};
  }
  if (row.provider_sid) {
    if (row.provider!=='twilio') throw new HttpError(409,'This number must be released by support.','UNSUPPORTED_PROVIDER');
    const creds=await credsFor(ctx.orgId);
    if (!creds) throw new HttpError(503,'Carrier is temporarily unavailable.','CARRIER_UNAVAILABLE');
    // Keep ownership intact if the carrier rejects the release. A retry after
    // successful release is safe: the provider treats an absent number as done.
    await release(String(row.provider_sid),creds);
  }
  await sql`delete from app_private.phone_numbers where id=${id} and org_id=${ctx.orgId} and user_id=${ctx.uid}`;
  return {removed:true};
}
