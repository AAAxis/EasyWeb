import { sql } from './db.ts';
import { env } from './env.ts';
import { HttpError } from './http.ts';
import { credsFor } from './providers/twilioAccount.ts';

// The attempt nonce stays server-side; only its six-digit challenge is returned
// to the app. A signed carrier callback must supply the digits entered by phone.
async function proofCode(key:string) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
  return String(new DataView(digest).getUint32(0)%1000000).padStart(6,'0');
}

function verificationFailure(status:number,code:unknown) {
  const carrierCode=Number.isInteger(Number(code))?Number(code):0;
  console.warn('caller_id_verification_failed',{status,carrierCode});
  return new HttpError(503,`Could not start the verification call. Please try again. (Reference: ${carrierCode||status})`,'VERIFICATION_FAILED');
}

export async function startPersonalNumberVerification(ctx:{uid:string;orgId:number},phone:string) {
  if(!/^\+[1-9]\d{6,14}$/.test(phone))throw new HttpError(400,'Enter a valid number with country code.','INVALID_NUMBER');
  const creds=await credsFor(ctx.orgId);
  if(!creds)throw new HttpError(503,'Calling is temporarily unavailable.','CARRIER_UNAVAILABLE');
  const number=await sql.begin(async(tx)=>{
    await tx`insert into app_private.phone_numbers(org_id,user_id,phone_number,provider,is_verified,is_primary)
      values(${ctx.orgId},${ctx.uid},${phone},'twilio',false,false) on conflict(org_id,phone_number) do nothing`;
    const [existing]=await tx`select * from app_private.phone_numbers where org_id=${ctx.orgId} and phone_number=${phone} for update`;
    if(existing.user_id!==ctx.uid)throw new HttpError(409,'Number is assigned to another user.','NUMBER_ALREADY_ASSIGNED');
    if(existing.is_verified) {
      await tx`update app_private.phone_numbers set is_primary=false where org_id=${ctx.orgId} and user_id=${ctx.uid}`;
      await tx`update app_private.phone_numbers set is_primary=true where id=${existing.id}`;
      return existing;
    }
    if(existing.verification_requested_at && Date.now()-new Date(existing.verification_requested_at).getTime()<60000)
      throw new HttpError(429,'Please wait one minute before requesting another verification call.','VERIFICATION_RATE_LIMIT');
    const [updated]=await tx`update app_private.phone_numbers set verification_key=gen_random_uuid(),verification_requested_at=now()
      where id=${existing.id} returning *`;
    return updated;
  });
  if(number.is_verified)return {already_verified:true,phone_number:phone};
  const callback=new URL(`${env('SUPABASE_URL')}/functions/v1/twilio/callerid`);
  callback.searchParams.set('org',String(ctx.orgId));callback.searchParams.set('user',ctx.uid);
  callback.searchParams.set('key',number.verification_key);
  const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/OutgoingCallerIds.json`,{
    method:'POST',headers:{Authorization:creds.bearer?`Bearer ${creds.bearer}`:`Basic ${btoa(`${creds.authUser??creds.accountSid}:${creds.authToken}`)}`,
      'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({PhoneNumber:phone,StatusCallback:callback.toString(),StatusCallbackMethod:'POST'}),signal:AbortSignal.timeout(15000),
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok && Number(data.code)===21450) {
    // An existing carrier caller ID is not proof that THIS app user owns it.
    // Confirm possession without deleting it or disrupting existing calls.
    const headers={Authorization:creds.bearer?`Bearer ${creds.bearer}`:`Basic ${btoa(`${creds.authUser??creds.accountSid}:${creds.authToken}`)}`};
    const base=`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}`;
    const check=await fetch(`${base}/OutgoingCallerIds.json?PhoneNumber=${encodeURIComponent(phone)}`,{headers,signal:AbortSignal.timeout(10000)});
    const known=await check.json().catch(()=>({}));
    if(!check.ok||!known.outgoing_caller_ids?.some((n:{phone_number:string})=>n.phone_number===phone))
      throw verificationFailure(check.status,known.code);
    const numbers=await fetch(`${base}/IncomingPhoneNumbers.json?PageSize=100`,{headers,signal:AbortSignal.timeout(10000)});
    const available=await numbers.json().catch(()=>({}));
    const from=available.incoming_phone_numbers?.find((n:{phone_number:string;capabilities?:{voice?:boolean}})=>n.capabilities?.voice===true&&n.phone_number!==phone)?.phone_number;
    if(!numbers.ok||!from)throw verificationFailure(numbers.status,available.code);
    const code=await proofCode(number.verification_key);
    callback.pathname=callback.pathname.replace(/callerid$/,'callerid-proof');
    const action=callback.toString().replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    const call=await fetch(`${base}/Calls.json`,{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({To:phone,From:from,Timeout:'25',TimeLimit:'60',
        Twiml:`<Response><Gather input="dtmf" numDigits="6" timeout="20" action="${action}" method="POST"><Say>To verify your number for EasyCall, enter the six digit code displayed in the app.</Say></Gather><Hangup/></Response>`}),signal:AbortSignal.timeout(15000)});
    const started=await call.json().catch(()=>({}));
    if(!call.ok||!started.sid)throw verificationFailure(call.status,started.code);
    return {validation_code:code,phone_number:phone};
  }
  if(!response.ok||!data.validation_code)throw verificationFailure(response.status,data.code);
  return {validation_code:String(data.validation_code),phone_number:phone};
}

export async function confirmPersonalNumberProof(input:{orgId:number;uid:string;key:string;accountSid:string;phone:string;digits:string}) {
  if(!input.key||!/^\d{6}$/.test(input.digits)||input.digits!==await proofCode(input.key))return;
  await confirmPersonalNumber({...input,status:'success'});
}

export async function personalNumberStatus(ctx:{uid:string;orgId:number},phone:string) {
  const [row]=await sql`select is_verified from app_private.phone_numbers where org_id=${ctx.orgId} and user_id=${ctx.uid} and phone_number=${phone}`;
  return {verified:row?.is_verified===true};
}

export async function confirmPersonalNumber(input:{orgId:number;uid:string;key:string;accountSid:string;phone:string;status:string}) {
  if(!input.orgId||!input.uid||!input.key||input.status!=='success')return;
  const creds=await credsFor(input.orgId);
  if(!creds||creds.accountSid!==input.accountSid)throw new HttpError(403,'Carrier account mismatch.','INVALID_CALLBACK');
  // A successful callback can verify only this user's most recent attempt.
  // It never creates a purchased number or permits SMS from a personal number.
  await sql.begin(async(tx)=>{
    const [row]=await tx`select id from app_private.phone_numbers where org_id=${input.orgId} and user_id=${input.uid}
      and phone_number=${input.phone} and verification_key::text=${input.key} and provider_sid is null
      and verification_requested_at>now()-interval '15 minutes' for update`;
    if(!row)return;
    await tx`update app_private.phone_numbers set is_primary=false where org_id=${input.orgId} and user_id=${input.uid}`;
    await tx`update app_private.phone_numbers set is_verified=true,is_primary=true,verification_key=null where id=${row.id}`;
  });
}
