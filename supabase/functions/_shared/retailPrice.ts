// Provider USD cost × 2, rounded up only at the final cent boundary.
export function retailUsdCents(providerUsd: string): number {
  if (!/^\d+(\.\d{1,9})?$/.test(providerUsd)) throw new Error("Invalid provider price");
  const [whole, fraction = ""] = providerUsd.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const units = BigInt(whole) * scale + BigInt(fraction || "0");
  const cents = (units * 200n + scale - 1n) / scale;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Provider price too large");
  return Number(cents);
}
