// DIDWW, the house carrier's account. Only the balance is read here.
//
// Their v3 API is JSON:API: the key goes in an `Api-Key` header, and the
// balance is a singleton resource whose amounts arrive as decimal strings.
const API = "https://api.didww.com/v3";

/** What is left to spend: the account balance, not including any credit line. */
export async function balance(key: string): Promise<number> {
  const res = await fetch(`${API}/balance`, {
    headers: { "Api-Key": key, Accept: "application/vnd.api+json" },
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(res.status === 401 || res.status === 403 ? "DIDWW rejected that API key." : `DIDWW answered ${res.status}`);
  }
  const value = Number((body as { data?: { attributes?: { balance?: string } } })?.data?.attributes?.balance);
  if (!Number.isFinite(value)) throw new Error("DIDWW returned no balance.");
  return value;
}
