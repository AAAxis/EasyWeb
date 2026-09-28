import { sql } from './db.ts';
import { env } from './env.ts';
import { HttpError } from './http.ts';

// Durable keys and amounts are stored before contacting RevenueCat. Ambiguous
// network failures always retry the same transaction, including refunds.
export async function settleNumberPayment(order: any) {
  const refund = order.payment_status === 'refunding';
  if (order.payment_status !== 'processing' && !refund) return;
  const response = await fetch(`https://api.revenuecat.com/v2/projects/${env('REVENUECAT_PROJECT_ID','projeec6eacb')}/customers/${encodeURIComponent(order.user_id)}/virtual_currencies/transactions`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${env('REVENUECAT_V2_SECRET_KEY')}`, 'Content-Type': 'application/json',
      'Idempotency-Key': `number-${refund ? 'refund' : 'pay'}-${order.payment_key}`},
    body: JSON.stringify({adjustments: {USD_CENTS: (refund ? 1 : -1) * order.monthly_price_cents}}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    await sql`update app_private.number_requests set payment_error=${'REVENUECAT_'+response.status} where id=${order.id} and payment_key=${order.payment_key} and payment_status in ('processing','refunding')`;
    if (response.status === 422 && !refund) {
      await sql`update app_private.number_requests set payment_status='failed',payment_error='INSUFFICIENT_BALANCE',updated_at=now()
        where id=${order.id} and payment_key=${order.payment_key} and payment_status='processing'`;
      throw new HttpError(402,'Not enough balance.','INSUFFICIENT_BALANCE');
    }
    throw new HttpError(503, refund ? 'Refund is processing. Please check your numbers again.' : 'Payment is processing. Please check your numbers again.', 'PAYMENT_PROCESSING');
  }
  if (refund) {
    await sql`update app_private.number_requests set payment_status='refunded',status='cancelled',refunded_at=now(),payment_error=null,updated_at=now()
      where id=${order.id} and payment_key=${order.payment_key} and payment_status='refunding'`;
  } else {
    await sql`update app_private.number_requests set payment_status='paid',paid_at=now(),payment_error=null,email_status='pending',updated_at=now()
      where id=${order.id} and payment_key=${order.payment_key} and payment_status='processing'`;
  }
  if (!refund) {
    const [cancelled] = await sql`update app_private.number_requests set payment_status='refunding',next_payment_attempt_at=now()
      where id=${order.id} and payment_status='paid' and cancel_requested=true and activation_status='idle' returning *`;
    if (cancelled) await settleNumberPayment(cancelled);
  }
}

export async function notifyPaidNumber(id: string) {
  const [order] = await sql`select * from app_private.number_requests where id=${id} and payment_status='paid' and status='pending' and email_status <> 'sent' and cancel_requested=false`;
  if (!order) return;
  const approvalUrl = `${env('NUMBER_APPROVAL_URL')}/#order=${order.id}&token=${order.approval_token}`;
  if (!env('NUMBER_APPROVAL_URL')) throw Error('APPROVAL_URL_MISSING');
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{Authorization:`Bearer ${env('RESEND_API_KEY')}`,'Content-Type':'application/json','Idempotency-Key':`number-paid-link/${order.id}`},
      body:JSON.stringify({from:env('NUMBER_APPROVAL_FROM',env('DELETION_REQUEST_FROM','privacy@montigate.com')),
        to:[env('NUMBER_APPROVAL_EMAIL')], subject:`EasyCall paid number: ${order.phone_number}`,
        text:`Paid number awaiting activation.\n\nReview and approve or reject/refund:\n${approvalUrl}\n\nOrder: ${order.id}\nCustomer: ${order.customer_email || order.user_id}\nUser ID: ${order.user_id}\nNumber: ${order.phone_number}\nCountry: ${order.country}\nPaid: USD ${(order.monthly_price_cents/100).toFixed(2)} (first month).\n\nCheck the current order status before activation; the customer can cancel and receive a refund while pending.`}),
      signal:AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('EMAIL_FAILED');
    const body=await response.json();
    await sql`update app_private.number_requests set email_status='sent',email_id=${body.id},updated_at=now() where id=${id}`;
  } catch {
    await sql`update app_private.number_requests set email_status='failed',next_payment_attempt_at=now()+interval '2 minutes' where id=${id} and email_status <> 'sent'`;
  }
}

export async function cancelNumberOrder(ctx: {uid:string;orgId:number}, id:string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400,'Invalid number.','INVALID_NUMBER');
  const order=await sql.begin(async(tx)=>{
    const [row]=await tx`select * from app_private.number_requests where id=${id} and user_id=${ctx.uid} and org_id=${ctx.orgId} for update`;
    if (!row) throw new HttpError(404,'Number not found.','NOT_FOUND');
    if (row.status==='cancelled') return row;
    if (row.status!=='pending') throw new HttpError(409,'This number is already activated and cannot be cancelled here.','NOT_PENDING');
    if (row.activation_status==='processing') throw new HttpError(409,'Activation is processing. Please try again shortly.','ACTIVATION_PROCESSING');
    if (row.payment_status==='processing') {
      const [updated]=await tx`update app_private.number_requests set cancel_requested=true,next_payment_attempt_at=now(),updated_at=now() where id=${id} returning *`;
      return updated;
    }
    if (row.payment_status==='refunding') return row;
    if (row.payment_status==='paid') {
      const [updated]=await tx`update app_private.number_requests set payment_status='refunding',next_payment_attempt_at=now()+interval '2 minutes',updated_at=now() where id=${id} returning *`;
      return updated;
    }
    // Legacy requests were never charged: remove them without creating money.
    const [updated]=await tx`update app_private.number_requests set status='cancelled',updated_at=now() where id=${id} returning *`;
    return updated;
  });
  if (order.payment_status==='processing') return {cancelled:true,refund_pending:true};
  await settleNumberPayment(order);
  return {cancelled:true,refunded_cents: ['paid','refunding','refunded'].includes(order.payment_status) ? order.monthly_price_cents : 0};
}

export async function retryNumberPayments() {
  const jobs=await sql`update app_private.number_requests set next_payment_attempt_at=now()+interval '2 minutes'
    where id in (select id from app_private.number_requests where status='pending' and next_payment_attempt_at<=now()
      and (payment_status in ('processing','refunding') or (payment_status='paid' and email_status <> 'sent'))
      order by next_payment_attempt_at for update skip locked limit 5) returning *`;
  // RevenueCat serializes balance changes per customer. Process this small
  // batch in order so several purchases for one wallet do not race.
  for (const job of jobs) {
    try { await settleNumberPayment(job); await notifyPaidNumber(job.id); }
    catch {
      // A definitive insufficient-balance response means no debit happened.
      await sql`update app_private.number_requests set status='cancelled',updated_at=now()
        where id=${job.id} and cancel_requested=true and payment_status='failed'`;
    }
  }
  return jobs.length;
}
