import { sql } from './db.ts';
import { env } from './env.ts';
import { HttpError } from './http.ts';
import { usageRates } from './usageRates.ts';
import { smsSegments, smsReserveCents } from './smsSegments.ts';
import { parsePhoneNumberFromString } from 'npm:libphonenumber-js@1.12.9';
import { sendSms } from './providers/sms.ts';

async function wallet(order:any,refund=false) {
  const response=await fetch(`https://api.revenuecat.com/v2/projects/${env('REVENUECAT_PROJECT_ID','projeec6eacb')}/customers/${encodeURIComponent(order.user_id)}/virtual_currencies/transactions`,{
    method:'POST',headers:{Authorization:`Bearer ${env('REVENUECAT_V2_SECRET_KEY')}`,'Content-Type':'application/json','Idempotency-Key':`sms-${refund?'refund':'pay'}-${order.id}`},
    body:JSON.stringify({adjustments:{USD_CENTS:(refund?1:-1)*order.amount_cents}}),signal:AbortSignal.timeout(12000),
  });
  if(!response.ok) {
    if(response.status===422&&!refund) {
      await sql`update app_private.sms_payments set state='failed',updated_at=now() where id=${order.id} and state='charging'`;
      throw new HttpError(402,'Add balance to send this message.','INSUFFICIENT_BALANCE');
    }
    throw new HttpError(503,'Payment could not be confirmed. The message has not been sent.','SMS_PAYMENT_PENDING');
  }
  await sql`update app_private.sms_payments set state=${refund?'refunded':'debited'},updated_at=now()
    where id=${order.id} and state=${refund?'refund_pending':'charging'}`;
}

export async function sendPrepaidSms(orgId:number,userId:string,message:{to:string;from:string;body:string},creds:any) {
  const destination=parsePhoneNumberFromString(message.to);
  if(!destination?.country) throw new HttpError(400,'Enter a full destination number with country code.','INVALID_NUMBER');
  let segments:number;
  try {segments=smsSegments(message.body,['US','CA'].includes(destination.country)&&/^\+1(800|888|877|866|855|844|833|822)/.test(message.from));}
  catch {throw new HttpError(400,'SMS must contain between 1 and 1600 characters.','INVALID_SMS_LENGTH');}
  // Reserve the displayed maximum x2 country tariff. Final carrier pricing can
  // refund the difference later; the message never relies on a delayed invoice.
  const rates=await usageRates(orgId,destination.country);
  const amount=smsReserveCents(rates.sms??[],segments);
  const [order]=await sql`insert into app_private.sms_payments(org_id,user_id,from_number,to_number,amount_cents)
    values(${orgId},${userId},${message.from},${destination.number},${amount}) returning *`;
  await wallet(order);
  const [claimed]=await sql`update app_private.sms_payments set state='sending',updated_at=now() where id=${order.id} and state='debited' returning *`;
  if(!claimed) throw new HttpError(409,'The message payment is already being handled.','SMS_PAYMENT_PENDING');
  let result;
  try {
    result=await sendSms({...message,to:destination.number,
      statusCallback:`${env('SUPABASE_URL')}/functions/v1/twilio/sms-status?org=${orgId}&uid=${encodeURIComponent(userId)}&payment=${order.id}`},creds);
  } catch {
    // A transport timeout does not prove rejection. Never retry the carrier
    // send automatically; its signed callback can recover the provider SID.
    return {provider:'twilio',providerMessageId:null,status:'queued' as const,error:'Delivery confirmation pending.'};
  }
  if(result.providerMessageId) {
    await sql`update app_private.sms_payments set state='sent',provider_sid=${result.providerMessageId},updated_at=now() where id=${order.id} and state in ('sending','sent')`;
  } else if(result.status==='failed' && result.definitiveFailure) {
    await sql`update app_private.sms_payments set state='refund_pending',updated_at=now() where id=${order.id} and state='sending'`;
    try {await wallet(order,true);} catch { /* Scheduled worker completes the refund. */ }
  }
  return result;
}

export async function recordSmsPaymentCallback(id:string,userId:string,orgId:number,sid:string) {
  if(!/^[0-9a-f-]{36}$/i.test(id)||!/^SM[a-f0-9]{32}$/i.test(sid)) return;
  await sql`update app_private.sms_payments set state='sent',provider_sid=${sid},updated_at=now()
    where id=${id} and user_id=${userId} and org_id=${orgId} and state in ('sending','sent')`;
}

export async function recoverSmsPayments() {
  const jobs=await sql`update app_private.sms_payments set next_attempt_at=now()+interval '2 minutes'
    where id in(select id from app_private.sms_payments where state in ('charging','debited','refund_pending') and next_attempt_at<=now()
      order by next_attempt_at for update skip locked limit 5) returning *`;
  for(const job of jobs) {
    try {
      if(job.state==='charging') await wallet(job);
      const [refund]=await sql`update app_private.sms_payments set state='refund_pending' where id=${job.id} and state in ('debited','refund_pending') returning *`;
      if(refund) await wallet(refund,true);
    } catch { /* Retry durable payment/refund only, never an ambiguous SMS send. */ }
  }
}
