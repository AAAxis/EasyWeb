// DIDLogic, as a source of numbers.
//
// Their API is split across two versions and neither is discoverable from the
// other: v1 holds the account (balance, SIP accounts, purchases) and v2 holds
// the numbers. Both take the same bearer key, so the split is theirs to
// explain, not something to paper over — each call below names the version it
// needs.
//
// Verified against a live account: /v1/balance.json, /v1/sipaccounts.json,
// /v1/purchases.json, /v1/sms.json and /v2/numbers.json all answer. There is a
// /v2/numbers/search.json, but it returned an empty page for every parameter
// name tried, so buying is not wired up here — see `search`.
const V1 = "https://app.didlogic.com/api/v1";
const V2 = "https://app.didlogic.com/api/v2";

export type DidlogicNumber = {
  id?: number;
  number: string;
  country?: string;
  area?: string;
  channels?: number;
};

async function call(key: string, url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body as { error?: string })?.error ?? `DIDLogic answered ${res.status}`;
    throw new Error(res.status === 401 ? "DIDLogic rejected that API key." : message);
  }
  return body;
}

/** Proves a key works, and returns what to call the account on screen. */
export async function verify(key: string): Promise<{ balance: number; sipAccounts: number }> {
  const [balance, sip] = await Promise.all([
    call(key, `${V1}/balance.json`) as Promise<{ balance?: number }>,
    call(key, `${V1}/sipaccounts.json`).catch(() => ({})) as Promise<{ sipaccounts?: unknown[] }>,
  ]);
  return {
    balance: Number(balance?.balance ?? 0),
    sipAccounts: Array.isArray(sip?.sipaccounts) ? sip.sipaccounts.length : 0,
  };
}

/** What is left to spend. The dashboard shows this; the phone app does not. */
export async function balance(key: string): Promise<number> {
  const body = await call(key, `${V1}/balance.json`) as { balance?: number };
  return Number(body?.balance ?? 0);
}

/** The numbers this account holds. v2 carries more than v1's purchases list. */
export async function numbers(key: string): Promise<DidlogicNumber[]> {
  const body = await call(key, `${V2}/numbers.json`) as { dids?: DidlogicNumber[] };
  return (body?.dids ?? []).map((d) => ({
    id: d.id,
    number: String(d.number ?? ""),
    country: d.country,
    area: d.area,
    channels: d.channels,
  }));
}

/** The trunks calls actually leave by. */
export async function sipAccounts(key: string): Promise<{ id: number; label: string; callerId: string }[]> {
  const body = await call(key, `${V1}/sipaccounts.json`) as {
    sipaccounts?: { id: number; label?: string; name?: string; callerid?: string }[];
  };
  return (body?.sipaccounts ?? []).map((a) => ({
    id: a.id,
    label: a.label || a.name || String(a.id),
    callerId: a.callerid ?? "",
  }));
}

/**
 * Numbers available to buy.
 *
 * /v2/numbers/search.json exists and answers 200, but returns an empty page for
 * country, country_id, country_iso and prefix alike — so the parameter names it
 * actually wants are not known here. Rather than ship a search box that always
 * says "nothing found", this reports that plainly and buying stays where it
 * already works: DIDLogic's own console.
 */
export function searchUnavailable(): string {
  return "Buying through DIDLogic is not wired up yet — their search API needs parameters we do not have. Numbers bought in DIDLogic's console appear here automatically.";
}
