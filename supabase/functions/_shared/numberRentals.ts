import { sql } from './db.ts';
import { env } from './env.ts';
import { credsFor } from './providers/twilioAccount.ts';
import { release } from './providers/numbers.ts';
import { sendFcm } from './fcm.ts';
import { rentalWarningText } from './numberRentalMessages.ts';
import { rentalSchedule } from './numberRentalSchedule.ts';

/** Called in the same transaction that assigns the activated number. */
export async function enrollNumberRental(tx:any, order:any, phone:any, accountSid:string, activatedAt=new Date()) {
  const dates=rentalSchedule(activatedAt);
  await tx`insert into app_private.number_rentals(order_id,org_id,user_id,phone_number,provider_sid,provider_account_sid,
    rental_price_cents,period_starts_at,warning_at,expires_at,next_attempt_at)
    values(${order.id},${order.org_id},${order.user_id},${order.phone_number},${phone.sid},${accountSid},
      ${order.monthly_price_cents},${dates.periodStartsAt},${dates.warningAt},${dates.expiresAt},${dates.warningAt})
    on conflict(order_id) do nothing`;
}

export async function chargeRental(rental:any):Promise<'paid'|'insufficient'> {
  const secret=env('REVENUECAT_V2_SECRET_KEY');
  if(!secret)throw Error('BILLING_NOT_CONFIGURED');
  const response=await fetch(`https://api.revenuecat.com/v2/projects/${env('REVENUECAT_PROJECT_ID','projeec6eacb')}/customers/${encodeURIComponent(rental.user_id)}/virtual_currencies/transactions`,{
    method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json',
      'Idempotency-Key':`number-rent-${rental.id}-${rental.cycle}`},
    body:JSON.stringify({adjustments:{USD_CENTS:-rental.rental_price_cents}}),signal:AbortSignal.timeout(10000),
  });
  const body=await response.json().catch(()=>({}));
  // A network/configuration error is never permission to lose a phone number.
  if(response.status===422 && body.type==='unprocessable_entity_error' && body.param==='adjustments'
    && /balance.*(?:not enough|insufficient)|insufficient.*balance/i.test(String(body.message)))return 'insufficient';
  if(!response.ok)throw Error(`REVENUECAT_${response.status}`);
  const balance=body.items?.find((item:any)=>item.currency_code==='USD_CENTS')?.balance;
  if(!Number.isSafeInteger(balance)||balance<0)throw Error('PAYMENT_UNCONFIRMED');
  return 'paid';
}

async function warn(rental:any) {
  const [user]=await sql`select locale from app_private.users where id=${rental.user_id}`;
  const text=rentalWarningText(user?.locale,rental.phone_number,rental.rental_price_cents);
  const tokens=await sql`select d.id,d.token from app_private.device_tokens d
    where d.user_id=${rental.user_id} and d.is_active=true and not exists(
      select 1 from app_private.number_rental_warnings w where w.rental_id=${rental.id}
      and w.cycle=${rental.cycle} and w.device_token_id=d.id and w.sent_at is not null) limit 10`;
  await Promise.all(tokens.map(async(device:any)=>{
    const result=await sendFcm(device.token,text.title,text.body,'/numbers',undefined,`rent-${rental.id}-${rental.cycle}`);
    if(result.unregistered)await sql`update app_private.device_tokens set is_active=false where id=${device.id} and token=${device.token}`;
    if(result.status<200||result.status>=300)throw Error(`PUSH_${result.status}`);
    await sql`insert into app_private.number_rental_warnings(rental_id,cycle,device_token_id,sent_at)
      values(${rental.id},${rental.cycle},${device.id},now()) on conflict(rental_id,cycle,device_token_id) do update set sent_at=now(),last_error=null`;
  }));
  // Recheck for new devices during the warning day; sent-device receipts deduplicate.
  await sql`update app_private.number_rentals set next_attempt_at=least(expires_at,now()+interval '1 hour'),
    lease_until=null,lease_token=null,last_error=null where id=${rental.id} and lease_token=${rental.lease_token}`;
}

export async function processNumberRental(rental:any) {
  const [owned]=await sql`select id from app_private.phone_numbers where org_id=${rental.org_id} and user_id=${rental.user_id}
    and phone_number=${rental.phone_number} and provider_sid=${rental.provider_sid} and provider='twilio'`;
  if(!owned)throw Error('NUMBER_OWNERSHIP_CHANGED');
  if(rental.state==='active')return await warn(rental);
  if(rental.state==='charging') {
    await sql`insert into app_private.number_rental_payments(rental_id,cycle,amount_cents)
      values(${rental.id},${rental.cycle},${rental.rental_price_cents}) on conflict(rental_id,cycle) do nothing`;
    const result=await chargeRental(rental);
    if(result==='paid') {
      const dates=rentalSchedule(rental.expires_at);
      await sql.begin(async(tx)=>{
        const [locked]=await tx`select id from app_private.number_rentals where id=${rental.id} and lease_token=${rental.lease_token} for update`;
        if(!locked)throw Error('RENTAL_LEASE_LOST');
        await tx`update app_private.number_rental_payments set status='paid',settled_at=now() where rental_id=${rental.id} and cycle=${rental.cycle}`;
        await tx`update app_private.number_rentals set state='active',cycle=cycle+1,period_starts_at=${dates.periodStartsAt},
          warning_at=${dates.warningAt},expires_at=${dates.expiresAt},next_attempt_at=${dates.warningAt},last_error=null,
          lease_until=null,lease_token=null,updated_at=now() where id=${rental.id}`;
      });
      return;
    }
    await sql.begin(async(tx)=>{
      const [locked]=await tx`select id from app_private.number_rentals where id=${rental.id} and lease_token=${rental.lease_token} for update`;
      if(!locked)throw Error('RENTAL_LEASE_LOST');
      await tx`update app_private.number_rental_payments set status='insufficient',settled_at=now() where rental_id=${rental.id} and cycle=${rental.cycle}`;
      await tx`update app_private.number_rentals set state='releasing',last_error='INSUFFICIENT_BALANCE',updated_at=now() where id=${rental.id}`;
    });
    rental.state='releasing';
  }
  if(rental.state!=='releasing')throw Error('INVALID_RENTAL_STATE');
  const creds=await credsFor(Number(rental.org_id));
  if(!creds||creds.accountSid!==rental.provider_account_sid)throw Error('CARRIER_ACCOUNT_CHANGED');
  await release(rental.provider_sid,creds);
  // Only forget ownership once the carrier confirms deletion (404 is a safe retry).
  await sql.begin(async(tx)=>{
    const [locked]=await tx`select id from app_private.number_rentals where id=${rental.id} and lease_token=${rental.lease_token} for update`;
    if(!locked)throw Error('RENTAL_LEASE_LOST');
    await tx`delete from app_private.phone_numbers where id=${owned.id} and user_id=${rental.user_id} and org_id=${rental.org_id} and provider_sid=${rental.provider_sid}`;
    await tx`update app_private.number_rentals set state='released',released_at=now(),last_error=null,lease_until=null,lease_token=null,updated_at=now() where id=${rental.id}`;
  });
}

export async function processNumberRentals() {
  // Claim and persist charging BEFORE calling RevenueCat. Manual release must wait
  // for this state to reconcile; every retry uses the same rental/cycle payment key.
  const jobs=await sql`update app_private.number_rentals set lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',
    state=case when state='active' and expires_at<=now() then 'charging' else state end
    where id in(select id from app_private.number_rentals where state<>'released' and next_attempt_at<=now()
      and (lease_until is null or lease_until<now()) order by next_attempt_at for update skip locked limit 5) returning *`;
  await Promise.all(jobs.map(async(job:any)=>{
    try { await processNumberRental(job); }
    catch(error) {
      await sql`update app_private.number_rentals set last_error=${(error instanceof Error?error.message:'UNKNOWN').slice(0,150)},
        next_attempt_at=now()+interval '5 minutes',lease_token=null,lease_until=null where id=${job.id} and lease_token=${job.lease_token}`;
    }
  }));
  return jobs.length;
}
