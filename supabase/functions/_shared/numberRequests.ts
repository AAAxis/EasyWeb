import { settleNumberPayment, notifyPaidNumber } from "./numberPayments.ts";
import { sql } from "./db.ts";
import { env } from "./env.ts";
import { HttpError } from "./http.ts";
import { customerCatalog } from "./providers/numbers.ts";
import type { OrgContext } from "./auth.ts";

export const numberRequestsConfigured = () => Boolean(env("NUMBER_APPROVAL_EMAIL") && env("RESEND_API_KEY") && env("REVENUECAT_V2_SECRET_KEY"));

export async function customerUsdBalance(uid: string): Promise<number> {
  const project = env("REVENUECAT_PROJECT_ID", "projeec6eacb");
  const response = await fetch(`https://api.revenuecat.com/v2/projects/${project}/customers/${encodeURIComponent(uid)}/virtual_currencies`, {
    headers: { Authorization: `Bearer ${env("REVENUECAT_V2_SECRET_KEY")}` },
  });
  if (response.status === 404) return 0;
  if (!response.ok) throw new HttpError(503, "Balance is temporarily unavailable.", "BALANCE_UNAVAILABLE");
  const data = await response.json();
  const balance = data.items?.find((item: { currency_code: string }) => item.currency_code === "USD_CENTS")?.balance ?? 0;
  if (!Number.isSafeInteger(balance) || balance < 0) throw new HttpError(503, "Balance is temporarily unavailable.", "BALANCE_UNAVAILABLE");
  return balance;
}

export async function listNumberRequests(ctx: OrgContext) {
  return await sql`select id, phone_number, country, monthly_price_cents, status, payment_status, cancel_requested, email_status, created_at
    from app_private.number_requests where user_id = ${ctx.uid} and org_id = ${ctx.orgId}
    order by created_at desc limit 100`;
}

export async function requestNumber(ctx: OrgContext, input: { phone_number?: string; country?: string; expected_price_cents?: number }) {
  if (!numberRequestsConfigured()) throw new HttpError(503, "Number purchases are temporarily unavailable.", "NUMBER_PURCHASES_UNAVAILABLE");
  const phone = input.phone_number ?? "";
  const country = String(input.country ?? "").toUpperCase();
  if (!/^\+\d{7,15}$/.test(phone) || !/^[A-Z]{2}$/.test(country)) throw new HttpError(400, "Choose a valid number and country.", "INVALID_NUMBER");
  if (!Number.isSafeInteger(input.expected_price_cents) || Number(input.expected_price_cents) <= 0)
    throw new HttpError(409, "Update the app to confirm payment for this number.", "PAYMENT_CONFIRMATION_REQUIRED");
  let [order] = await sql`select * from app_private.number_requests where user_id=${ctx.uid} and org_id=${ctx.orgId} and phone_number=${phone} and status='pending'`;
  if (!order || ['unpaid','failed'].includes(order.payment_status)) {
    const candidate = (await customerCatalog(country, phone)).find(number => number.phone_number === phone);
    if (!candidate) throw new HttpError(409,"This number is no longer available.","NUMBER_UNAVAILABLE");
    if (candidate.monthly_price_cents !== input.expected_price_cents) throw new HttpError(409,"The price changed. Please reload the numbers.","PRICE_CHANGED");
    if (await customerUsdBalance(ctx.uid) < candidate.monthly_price_cents) throw new HttpError(402,"Not enough balance.","INSUFFICIENT_BALANCE");
    order = await sql.begin(async(tx)=>{
      await tx`select pg_advisory_xact_lock(hashtextextended(${ctx.uid},0))`;
      const [existing]=await tx`select * from app_private.number_requests where user_id=${ctx.uid} and org_id=${ctx.orgId} and phone_number=${phone} and status='pending' for update`;
      if (existing && !['unpaid','failed'].includes(existing.payment_status)) return existing;
      const [pending]=await tx`select count(*)::integer as count from app_private.number_requests where user_id=${ctx.uid} and status='pending' and payment_status in ('processing','paid','refunding')`;
      if (pending.count>=5) throw new HttpError(409,"Please wait for your pending numbers to be activated.","REQUEST_LIMIT");
      if (existing) {
        const [row]=await tx`update app_private.number_requests set payment_status='processing',payment_key=gen_random_uuid(),
          monthly_price_cents=${candidate.monthly_price_cents},customer_email=${String(ctx.claims.email ?? '')},
          email_status='pending',next_payment_attempt_at=now()+interval '2 minutes',updated_at=now()
          where id=${existing.id} returning *`;
        return row;
      }
      const [row]=await tx`insert into app_private.number_requests (org_id,user_id,phone_number,country,monthly_price_cents,payment_status,customer_email,next_payment_attempt_at)
        values (${ctx.orgId},${ctx.uid},${phone},${country},${candidate.monthly_price_cents},'processing',${String(ctx.claims.email ?? '')},now()+interval '2 minutes') returning *`;
      return row;
    });
  }
  if (order.cancel_requested) throw new HttpError(409,"This number is being cancelled.","CANCELLATION_PROCESSING");
  if (order.monthly_price_cents !== input.expected_price_cents) throw new HttpError(409,"The price changed. Please reload the numbers.","PRICE_CHANGED");
  if (order.payment_status==='refunding') throw new HttpError(409,"This number is being refunded.","REFUND_PROCESSING");
  await settleNumberPayment(order);
  // Notification failures cannot turn a completed payment into a failed purchase.
  // The scheduled worker retries notifications independently.
  EdgeRuntime.waitUntil(notifyPaidNumber(order.id));
  const [result]=await sql`select id,phone_number,country,monthly_price_cents,status,payment_status,email_status,created_at from app_private.number_requests where id=${order.id}`;
  return result;
}
