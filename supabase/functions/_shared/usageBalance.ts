import { env } from './env.ts';
import { HttpError } from './http.ts';

/** Fresh server balance: cached SDK wallets never authorize paid usage. */
export async function requireCallBalance(userId: string) {
  const secret = env('REVENUECAT_V2_SECRET_KEY');
  if (!secret) throw new HttpError(503, 'Balance is temporarily unavailable.', 'BALANCE_UNAVAILABLE');
  const response = await fetch(`https://api.revenuecat.com/v2/projects/${env('REVENUECAT_PROJECT_ID','projeec6eacb')}/customers/${encodeURIComponent(userId)}/virtual_currencies`, {
    headers: {Authorization:`Bearer ${secret}`}, signal:AbortSignal.timeout(10000),
  });
  if (response.status === 404) throw new HttpError(402, 'Add balance to make a call.', 'INSUFFICIENT_BALANCE');
  if (!response.ok) throw new HttpError(503, 'Balance is temporarily unavailable.', 'BALANCE_UNAVAILABLE');
  const data = await response.json();
  const balance = data.items?.find((item: any) => item.currency_code === 'USD_CENTS')?.balance ?? 0;
  if (!Number.isSafeInteger(balance) || balance < 0) throw new HttpError(503, 'Balance is temporarily unavailable.', 'BALANCE_UNAVAILABLE');
  // Authorization happens at the signed carrier webhook, which atomically
  // deducts the call's own prepayment. Older invoice delays never gate new calls.
  if (balance < 25) throw new HttpError(402, 'Add balance to make a call.', 'INSUFFICIENT_BALANCE');
  return { allowed:true };
}
