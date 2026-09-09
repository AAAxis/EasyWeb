// OxaPay — the crypto float, and how it is topped up.
//
// There is no wallet table behind this on purpose. OxaPay already keeps the
// balance and the history of every payment into it; mirroring that into our own
// ledger would mean a webhook, an idempotency key and two records of the same
// money that can disagree. So OxaPay is the ledger, and this module only reads
// it and mints the invoice that adds to it.
//
// Two different keys, and they are not interchangeable — a fact that costs an
// afternoon if you learn it from a 401:
//
//   general_api_key   reads the account. Balance, and nothing that moves money.
//   merchant_api_key  creates invoices, and is also the secret OxaPay signs
//                     callbacks with. It is the one that can take payments.
//
// Both are deployment-wide rather than per-workspace: one OxaPay account behind
// the whole install, unlike the carrier credentials in `number_providers`.
import { env, has } from "../env.ts";
import { HttpError } from "../http.ts";

const API = "https://api.oxapay.com/v1";

const MIN_TOPUP_USD = 2;
const MAX_TOPUP_USD = 500;

export const configured = () => has("OXAPAY_MERCHANT_API_KEY") || has("OXAPAY_GENERAL_API_KEY");

/**
 * OxaPay answers 200 with the failure in the body about as often as it uses a
 * status code, and nests the payload under `data` only sometimes. One place
 * that knows both, so no caller has to.
 */
async function call(
  path: string,
  { key, keyHeader, body }: { key: string; keyHeader: string; body?: unknown },
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      [keyHeader]: key,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });

  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text);
  } catch { /* handled as a failure below */ }

  const inner = Number(parsed?.status ?? 200);
  if (!res.ok || !parsed || inner >= 400) {
    const message = String(parsed?.message ?? `OxaPay error ${res.status}`);
    console.error(`OxaPay ${path} failed:`, res.status, inner, text.slice(0, 300));
    throw new HttpError(502, message, "OXAPAY_ERROR");
  }
  return (parsed.data as Record<string, unknown>) ?? parsed;
}

/**
 * What is in the account, by coin.
 *
 * Every currency OxaPay supports comes back whether or not any of it is held,
 * so the zero ones are dropped — nineteen rows of nothing is not a balance.
 */
export async function balance() {
  const key = env("OXAPAY_GENERAL_API_KEY");
  if (!key) throw new HttpError(409, "OxaPay is not connected", "NO_OXAPAY");

  const data = await call("/general/account/balance", { key, keyHeader: "general_api_key" });
  const held = Object.entries(data)
    .map(([currency, amount]) => ({ currency, amount: Number(amount) }))
    .filter((row) => Number.isFinite(row.amount) && row.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  return { held, currencies: Object.keys(data).length };
}

/**
 * Where OxaPay sends the payer when they are done.
 *
 * The browser knows the origin it is running on and the function does not — a
 * function is handed an internal URL, never its public one. But an unchecked
 * URL from a request body is an open redirect wearing our merchant account, so
 * only our own hosts are accepted and anything else falls back to the
 * configured site.
 */
function safeReturnUrl(candidate: unknown): string | undefined {
  const fallback = env("BALANCE_SITE_URL") || undefined;
  if (typeof candidate !== "string" || !candidate) return fallback;
  try {
    const url = new URL(candidate);
    const ours = url.hostname === "localhost" ||
      url.hostname === "chatkit.cc" ||
      url.hostname.endsWith(".chatkit.cc");
    if (!ours || (url.protocol !== "https:" && url.hostname !== "localhost")) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

/**
 * An invoice to pay into the account. Returns OxaPay's hosted page — the payer
 * picks the coin there, so nothing here has to know or care which.
 *
 * No callback URL: the money lands in the OxaPay account either way, and the
 * balance route reads it from OxaPay. There is nothing on this side to update,
 * so there is nothing to call back to.
 */
export async function topUp(amountUsd: number, opts: { orgId: number; returnUrl?: unknown }) {
  const key = env("OXAPAY_MERCHANT_API_KEY");
  if (!key) throw new HttpError(409, "OxaPay is not connected", "NO_OXAPAY");

  if (!Number.isFinite(amountUsd) || amountUsd < MIN_TOPUP_USD) {
    throw new HttpError(400, `The smallest top-up is $${MIN_TOPUP_USD}`, "AMOUNT_TOO_SMALL");
  }
  if (amountUsd > MAX_TOPUP_USD) {
    throw new HttpError(400, `The largest top-up is $${MAX_TOPUP_USD}`, "AMOUNT_TOO_LARGE");
  }

  const amount = Math.round(amountUsd * 100) / 100;
  const returnUrl = safeReturnUrl(opts.returnUrl);

  const data = await call("/payment/invoice", {
    key,
    keyHeader: "merchant_api_key",
    body: {
      amount,
      lifetime: 60, // minutes
      // OxaPay caps order_id at 50 characters, which is why this is terse
      // rather than descriptive.
      order_id: `ec:${opts.orgId}`,
      description: `EasyCall balance top-up $${amount.toFixed(2)}`,
      ...(returnUrl ? { return_url: returnUrl } : {}),
    },
  });

  const paymentUrl = String(data.payment_url ?? data.paymentUrl ?? "");
  const trackId = String(data.track_id ?? data.trackId ?? "");
  if (!paymentUrl) {
    console.error("OxaPay invoice response had no payment_url:", JSON.stringify(data).slice(0, 300));
    throw new HttpError(502, "OxaPay did not return a payment page", "OXAPAY_ERROR");
  }

  return { url: paymentUrl, trackId, amount, expiresAt: data.expired_at ?? null };
}
