import { enrollNumberRental } from './numberRentals.ts';
import { sql } from './db.ts';
import { env } from './env.ts';
import { HttpError } from './http.ts';
import { credsFor } from './providers/twilioAccount.ts';
import { cancelNumberOrder } from './numberPayments.ts';

export async function reviewNumberOrder(input: {id?:string;token?:string;action?:string}) {
  if (![input.id,input.token].every(v=>typeof v==='string' && /^[0-9a-f-]{36}$/i.test(v)))
    throw new HttpError(403,'Invalid approval link.','INVALID_LINK');
  const [order]=await sql`select * from app_private.number_requests where id=${input.id} and approval_token=${input.token} and approval_expires_at>now()`;
  if (!order) throw new HttpError(403,'This approval link is invalid or expired.','INVALID_LINK');
  if (input.action==='view') return {phone_number:order.phone_number,customer_email:order.customer_email,
    monthly_price_cents:order.monthly_price_cents,status:order.cancel_requested && order.status==='pending' ? 'cancelling' : order.status,payment_status:order.payment_status,activation_status:order.activation_status};
  if (input.action==='reject') return await cancelNumberOrder({uid:order.user_id,orgId:Number(order.org_id)},order.id);
  if (input.action!=='approve') throw new HttpError(400,'Invalid action.','INVALID_ACTION');
  if (order.status==='approved') return {approved:true};
  // Claim activation atomically against cancellation. Retrying an interrupted
  // activation reconciles the exact provider number and order marker first.
  const [claimed]=await sql`update app_private.number_requests set activation_status='processing',activation_attempt_at=now()
    where id=${order.id} and status='pending' and payment_status='paid' and cancel_requested=false
      and (activation_status='idle' or activation_attempt_at<now()-interval '2 minutes') returning *`;
  if (!claimed) throw new HttpError(409,'Order must be paid and pending. An activation may already be processing.','ORDER_NOT_READY');
  const creds=await credsFor(Number(order.org_id));
  if (!creds) throw new HttpError(503,'Carrier credentials are unavailable.','CARRIER_UNAVAILABLE');
  const base=`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}`;
  const headers={Authorization:creds.bearer?`Bearer ${creds.bearer}`:`Basic ${btoa(`${creds.authUser??creds.accountSid}:${creds.authToken}`)}`};
  const marker=`easycall-order-${order.id}`;
  const lookup=await fetch(`${base}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(order.phone_number)}`,{headers,signal:AbortSignal.timeout(15000)});
  if (!lookup.ok) throw new HttpError(503,'Carrier lookup failed. Retry approval in two minutes.','CARRIER_UNAVAILABLE');
  const found=(await lookup.json()).incoming_phone_numbers ?? [];
  let phone=found.find((p:any)=>p.phone_number===order.phone_number);
  if (phone && phone.friendly_name!==marker) throw new HttpError(409,'Number already belongs to another carrier order. Contact support.','NUMBER_ALREADY_OWNED');
  if (!phone) {
    const response=await fetch(`${base}/IncomingPhoneNumbers.json`,{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({PhoneNumber:order.phone_number,FriendlyName:marker,VoiceUrl:`${env('SUPABASE_URL')}/functions/v1/twilio/incoming`,VoiceMethod:'POST',SmsUrl:`${env('SUPABASE_URL')}/functions/v1/twilio/sms`,SmsMethod:'POST'}),signal:AbortSignal.timeout(20000)});
    if (!response.ok) {
      if (response.status>=400 && response.status<500 && response.status!==408) {
        await sql`update app_private.number_requests set activation_status='idle' where id=${order.id} and activation_status='processing'`;
      }
      throw new HttpError(503,'The carrier could not activate this number. Retry or reject and refund if unavailable.','ACTIVATION_FAILED');
    }
    phone=await response.json();
  }
  if (!phone.sid || phone.phone_number!==order.phone_number) throw new HttpError(503,'Carrier activation needs verification.','ACTIVATION_UNCONFIRMED');
  await sql.begin(async(tx)=>{
    const [current]=await tx`select * from app_private.number_requests where id=${order.id} for update`;
    if (current.status==='approved') return;
    if (current.payment_status!=='paid' || current.activation_status!=='processing') throw new HttpError(409,'Order changed during activation.','ORDER_CHANGED');
    const [existing]=await tx`select * from app_private.phone_numbers where phone_number=${order.phone_number} for update`;
    if (existing && (existing.user_id!==order.user_id || Number(existing.org_id)!==Number(order.org_id) || existing.provider_sid!==phone.sid))
      throw new HttpError(409,'Number is assigned to another order.','NUMBER_ALREADY_ASSIGNED');
    if (!existing) await tx`insert into app_private.phone_numbers(org_id,user_id,phone_number,provider,provider_sid,is_verified,is_primary)
      values(${order.org_id},${order.user_id},${order.phone_number},'twilio',${phone.sid},true,false)`;
    await enrollNumberRental(tx,order,phone,creds.accountSid);
    await tx`update app_private.number_requests set status='approved',activation_status='active',updated_at=now() where id=${order.id}`;
  });
  return {approved:true};
}
