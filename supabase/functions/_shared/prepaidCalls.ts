import { sql } from './db.ts';
import { env } from './env.ts';
import { HttpError } from './http.ts';
import { credsFor } from './providers/twilioAccount.ts';
import { usdMicros,retailCents,callBudget,quotedCallCost } from './callPricing.ts';

const finalStates=new Set(['completed','failed','busy','no-answer','canceled']);
const auth=(c:any)=>({Authorization:c.bearer?`Bearer ${c.bearer}`:`Basic ${btoa(`${c.authUser??c.accountSid}:${c.authToken}`)}`});
const current=async(sid:string)=>(await sql`select * from app_private.call_payments where provider_sid=${sid}`)[0];

async function wallet(payment:any,cents:number,key:string) {
  const secret=env('REVENUECAT_V2_SECRET_KEY');
  if(!secret)throw new Error('BILLING_NOT_CONFIGURED');
  const response=await fetch(`https://api.revenuecat.com/v2/projects/${env('REVENUECAT_PROJECT_ID','projeec6eacb')}/customers/${encodeURIComponent(payment.user_id)}/virtual_currencies/transactions`,{
    method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json','Idempotency-Key':key},
    body:JSON.stringify({adjustments:{USD_CENTS:cents}}),signal:AbortSignal.timeout(5000),
  });
  if(!response.ok)throw new HttpError(response.status===422?402:503,
    response.status===422?'Add balance to make a call.':'The call payment could not be confirmed.',
    response.status===422?'INSUFFICIENT_BALANCE':'CALL_PAYMENT_PENDING');
}

async function debitPending(payment:any) {
  if(!payment.pending_cents)return payment;
  try {
    await wallet(payment,-Number(payment.pending_cents),`call-${payment.provider_sid}-reserve-${payment.charge_sequence}`);
  } catch(error) {
    if((error as any).code==='INSUFFICIENT_BALANCE') {
      await sql`update app_private.call_payments set pending_cents=0,charge_sequence=charge_sequence+1,
        state=case when paid_cents=0 then 'failed' else state end,stop_reason='INSUFFICIENT_BALANCE',updated_at=now()
        where provider_sid=${payment.provider_sid} and charge_sequence=${payment.charge_sequence}`;
    }
    throw error;
  }
  const [paid]=await sql`update app_private.call_payments set paid_cents=paid_cents+pending_cents,
    pending_cents=0,charge_sequence=charge_sequence+1,state='active',stop_reason=null,updated_at=now()
    where provider_sid=${payment.provider_sid} and charge_sequence=${payment.charge_sequence} and pending_cents>0 returning *`;
  return paid??await current(payment.provider_sid);
}

export async function authorizePrepaidCall(input:{sid:string;accountSid:string;orgId:number;userId:string;from:string;to:string;direction:'outbound'|'inbound'}) {
  if(!/^CA[a-f0-9]{32}$/i.test(input.sid)||!/^AC[a-f0-9]{32}$/i.test(input.accountSid))throw new Error('INVALID_CALL_IDENTITY');
  let payment=await current(input.sid);
  if(!payment) {
    const creds=await credsFor(input.orgId);
    if(!creds||creds.accountSid!==input.accountSid)throw new Error('PROVIDER_ACCOUNT_CHANGED');
    const number=input.to;
    if(!/^\+\d{7,15}$/.test(number))throw new HttpError(400,'Enter a full phone number.','INVALID_NUMBER');
    const quote=await fetch(`https://pricing.twilio.com/v2/Voice/Numbers/${encodeURIComponent(number)}?OriginationNumber=${encodeURIComponent(input.from)}`,{
      headers:auth(creds),signal:AbortSignal.timeout(4000),
    });
    if(!quote.ok)throw new Error('CALL_PRICE_UNAVAILABLE');
    const prices=await quote.json();
    if(String(prices.price_unit).toUpperCase()!=='USD')throw new Error('CALL_PRICE_UNAVAILABLE');
    const rates=input.direction==='outbound'?(prices.outbound_call_prices??[]):[prices.inbound_call_price];
    if(!rates.length)throw new Error('CALL_PRICE_UNAVAILABLE');
    const pstn=Math.max(...rates.map((p:any)=>usdMicros(p?.current_price)));
    // Published Twilio browser/app leg tariff. Configurable for contracted rates.
    const sdk=usdMicros(env('TWILIO_VOICE_SDK_USD_PER_MINUTE','0.004'));
    const minute=Math.max(1,retailCents(pstn+sdk));
    const overhead=Math.max(1,retailCents(input.direction==='outbound'?sdk:pstn));
    const initial=Math.max(25,minute+overhead);
    const [created]=await sql`insert into app_private.call_payments
      (provider_sid,provider_account_sid,org_id,user_id,direction,from_number,to_number,pstn_micros,sdk_micros,minute_cents,overhead_cents,pending_cents)
      values(${input.sid},${input.accountSid},${input.orgId},${input.userId},${input.direction},${input.from},${input.to},${pstn},${sdk},${minute},${overhead},${initial})
      on conflict(provider_sid) do nothing returning *`;
    payment=created??await current(input.sid);
  }
  if(payment.user_id!==input.userId||Number(payment.org_id)!==input.orgId||payment.provider_account_sid!==input.accountSid
    ||payment.to_number!==input.to||payment.from_number!==input.from||payment.direction!==input.direction)throw new Error('CALL_OWNER_MISMATCH');
  if(!['authorizing','active'].includes(payment.state))throw new Error('CALL_ALREADY_FINISHED');
  payment=await debitPending(payment);
  if(payment.state!=='active')throw new Error('CALL_ALREADY_FINISHED');
  const seconds=callBudget(Number(payment.paid_cents),Number(payment.overhead_cents),Number(payment.minute_cents));
  if(seconds<60)throw new Error('CALL_NOT_FUNDED');
  await sql`update app_private.call_payments set applied_limit_seconds=greatest(applied_limit_seconds,${seconds}),updated_at=now()
    where provider_sid=${input.sid}`;
  return {seconds,paidCents:Number(payment.paid_cents)};
}

export async function recordPrepaidCallStatus(parentSid:string,accountSid:string,childSid:string) {
  if(!/^CA[a-f0-9]{32}$/i.test(parentSid)||!/^CA[a-f0-9]{32}$/i.test(childSid))return;
  await sql`update app_private.call_payments set child_sid=coalesce(child_sid,${childSid})
    where provider_sid=${parentSid} and provider_account_sid=${accountSid} and state in ('authorizing','active')`;
}

async function carrier(payment:any,path:string,body?:Record<string,string>) {
  const creds=await credsFor(Number(payment.org_id));
  if(!creds||creds.accountSid!==payment.provider_account_sid)throw new Error('PROVIDER_ACCOUNT_CHANGED');
  const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}${path}`,{
    method:body?'POST':'GET',headers:{...auth(creds),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
    ...(body?{body:new URLSearchParams(body)}:{}),signal:AbortSignal.timeout(5000),
  });
  if(!response.ok)throw new Error(`TWILIO_${response.status}`);
  return await response.json();
}

async function finish(payment:any,parent:any,children:any[]) {
  if(children.some(c=>!finalStates.has(c.status)))return;
  if(payment.pending_cents)payment=await debitPending(payment);
  if(payment.final_cents===null) {
    const duration=(call:any)=>{
      if(call.status==='completed'&&(call.duration===null||call.duration===undefined))throw new Error('CALL_DURATION_PENDING');
      return Number(call.duration??0);
    };
    const cents=quotedCallCost(payment.direction,Number(payment.pstn_micros),Number(payment.sdk_micros),duration(parent),children.reduce((n,c)=>n+duration(c),0));
    const [updated]=await sql`update app_private.call_payments set final_cents=${cents},state='settling',updated_at=now()
      where provider_sid=${payment.provider_sid} and final_cents is null returning *`;
    payment=updated??await current(payment.provider_sid);
  }
  const adjustment=Number(payment.paid_cents)-Number(payment.final_cents);
  if(adjustment)await wallet(payment,adjustment,`call-${payment.provider_sid}-settle`);
  await sql`update app_private.call_payments set state='settled',settled_at=now(),last_error=null,updated_at=now()
    where provider_sid=${payment.provider_sid}`;
}

export async function processPrepaidCall(payment:any) {
  if(payment.state==='settling') {
    const adjustment=Number(payment.paid_cents)-Number(payment.final_cents);
    if(adjustment)await wallet(payment,adjustment,`call-${payment.provider_sid}-settle`);
    await sql`update app_private.call_payments set state='settled',settled_at=now(),last_error=null,updated_at=now() where provider_sid=${payment.provider_sid}`;
    return;
  }
  const [parent,result]=await Promise.all([
    carrier(payment,`/Calls/${payment.provider_sid}.json`),
    carrier(payment,`/Calls.json?ParentCallSid=${encodeURIComponent(payment.provider_sid)}&PageSize=100`),
  ]);
  if(result.next_page_uri)throw new Error('TOO_MANY_CALL_LEGS');
  const children=result.calls??[];
  if(children.some((c:any)=>c.parent_call_sid!==payment.provider_sid))throw new Error('CALL_OWNER_MISMATCH');
  if(children.length>1)throw new Error('UNEXPECTED_CALL_LEGS');
  if(finalStates.has(parent.status)){await finish(payment,parent,children);return;}
  const child=children.find((c:any)=>c.status==='in-progress');
  if(!child)return; // Initial TwiML's paid timeLimit already protects the call.
  const start=Date.parse(child.start_time);
  if(!Number.isFinite(start))throw new Error('CALL_START_PENDING');
  const elapsed=Math.max(0,(Date.now()-start)/1000);
  let seconds=callBudget(Number(payment.paid_cents),Number(payment.overhead_cents),Number(payment.minute_cents));
  if(payment.pending_cents)payment=await debitPending(payment);
  else if(elapsed>=seconds-30&&seconds<14400) {
    const [pending]=await sql`update app_private.call_payments set pending_cents=minute_cents,updated_at=now()
      where provider_sid=${payment.provider_sid} and state='active' and pending_cents=0 and charge_sequence=${payment.charge_sequence} returning *`;
    if(pending)payment=await debitPending(pending);
    else payment=await current(payment.provider_sid);
  }
  seconds=callBudget(Number(payment.paid_cents),Number(payment.overhead_cents),Number(payment.minute_cents));
  if(seconds>Number(payment.applied_limit_seconds)) {
    // Never extend first and charge later. A failed update leaves the old paid
    // carrier limit in force; final settlement returns any unused prepayment.
    await carrier(payment,`/Calls/${child.sid}.json`,{TimeLimit:String(seconds)});
    await sql`update app_private.call_payments set applied_limit_seconds=${seconds},last_error=null,updated_at=now() where provider_sid=${payment.provider_sid}`;
  }
}

export async function processPrepaidCalls() {
  const jobs=await sql`update app_private.call_payments set next_attempt_at=now()+interval '2 minutes'
    where provider_sid in(select provider_sid from app_private.call_payments
      where state in ('authorizing','active','settling') and next_attempt_at<=now()
      order by next_attempt_at for update skip locked limit 10) returning *`;
  await Promise.all(jobs.map(async(payment:any)=>{
    try {await processPrepaidCall(payment);}
    catch(error) {await sql`update app_private.call_payments set last_error=${String((error as any)?.code??(error as any)?.message??'BILLING_ERROR').slice(0,120)} where provider_sid=${payment.provider_sid}`;}
    finally {await sql`update app_private.call_payments set next_attempt_at=now()+interval '5 seconds' where provider_sid=${payment.provider_sid} and state in ('authorizing','active','settling')`;}
  }));
  return jobs.length;
}
