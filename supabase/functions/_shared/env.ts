// Reading configuration.
//
// `Deno.env.get(name) ?? fallback` looks right and is wrong: `??` only falls
// back on null/undefined, and a secret that exists with an empty value is a
// string. Pushing a template .env with blank placeholders sets exactly those,
// so every such fallback silently stops working — which is how an onboarding
// link went out with return_url="" and how an entitlement check started asking
// for "" instead of "pro".
//
// Everything here treats empty as absent.

export const env = (name: string, fallback = ""): string => {
  const value = Deno.env.get(name);
  return value === undefined || value.trim() === "" ? fallback : value;
};

/** For "is this configured at all" checks. */
export const has = (name: string): boolean => env(name) !== "";

/** Numeric config, with a fallback when unset, empty or not a number. */
export const envNumber = (name: string, fallback: number): number => {
  const raw = env(name);
  if (raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};
