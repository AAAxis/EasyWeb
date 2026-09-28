// Telling the two kinds of SIP call on our Twilio SIP domain apart.
//
// Twilio posts every call that reaches easycall-voip.sip.twilio.com to the
// same Voice URL with Direction="inbound" — a call a carrier (DIDWW) delivers
// to one of our numbers, and a call a softphone (Zoiper) registered to the
// domain places to the outside world, look alike. Treating the second as the
// first is what rejected outbound Zoiper calls: the dialled number was looked
// up as if it were one of ours being called.
//
// Pure on purpose — no database, no Twilio — so the rules are unit-tested.

export type SipUri = { user: string; host: string };

/**
 * The user and host of a sip:/sips: URI, or null when it is not one.
 *
 * Accepts the shapes Twilio forwards: `sip:user@host;transport=UDP`, and the
 * header form `"Name" <sip:user@host:5060>`. The user part is percent-decoded
 * (a `+` often arrives as %2B) and URI parameters are dropped.
 */
export function parseSipUri(raw: unknown): SipUri | null {
  let value = String(raw ?? "").trim();
  const bracketed = value.match(/<([^>]*)>/);
  if (bracketed) value = bracketed[1].trim();
  const scheme = value.match(/^sips?:/i);
  if (!scheme) return null;
  value = value.slice(scheme[0].length);
  const at = value.lastIndexOf("@");
  if (at <= 0) return null;
  let user: string;
  try {
    user = decodeURIComponent(value.slice(0, at).split(";")[0]);
  } catch {
    return null;
  }
  const host = value.slice(at + 1).split(/[;?>]/)[0].replace(/:\d+$/, "").toLowerCase();
  if (!user || !host) return null;
  return { user, host };
}

/**
 * A dialled string as E.164, or null when it cannot be one.
 *
 * `+972…`, `00972…` and a bare international `972…` are accepted; visual
 * separators are ignored. Anything carrying letters, `*`, `#` or too few
 * digits for an international number — service codes, extensions — is not a
 * PSTN destination and is refused rather than guessed at.
 */
export function toE164(raw: unknown): string | null {
  const value = String(raw ?? "").trim().replace(/[\s().\-]/g, "");
  if (!/^(\+|00)?\d+$/.test(value)) return null;
  const digits = value.startsWith("+") ? value.slice(1) : value.startsWith("00") ? value.slice(2) : value;
  const e164 = `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

export type SipRoutingConfig = {
  /** The Twilio SIP domain softphones register to, e.g. easycall-voip.sip.twilio.com. */
  domain: string;
  /** When set, the SipDomainSid Twilio reports must match it. */
  domainSid?: string;
  /** Carrier signalling IPs. A call from one of these is never a softphone's. */
  carrierIps?: string[];
};

export type SipCall =
  /** Not a SIP-domain call at all (PSTN, a Twilio number) — the ordinary inbound path. */
  | { kind: "pstn" }
  /** A carrier delivering a call to one of our numbers. */
  | { kind: "carrier" }
  /** A softphone on our domain placing a call. `username` still has to be authorized. */
  | { kind: "endpoint"; username: string; destination: string | null }
  | { kind: "reject"; reason: string };

/**
 * Which kind of call a Twilio voice webhook describes.
 *
 * A softphone call is one whose From is `<user>@<our domain>`, arriving on our
 * domain, from somewhere that is not a carrier. Everything else that arrived
 * on the domain is a carrier's. The username is returned unauthorized — the
 * caller must still match it to an active endpoint row.
 */
export function classifySipCall(params: Record<string, string>, config: SipRoutingConfig): SipCall {
  const to = parseSipUri(params.To);
  const onDomain = Boolean(params.SipDomainSid || params.SipDomain) || (to !== null && to.host.endsWith(".sip.twilio.com"));
  if (!onDomain) return { kind: "pstn" };

  const domain = config.domain.toLowerCase();
  if (config.domainSid && params.SipDomainSid && params.SipDomainSid !== config.domainSid) {
    return { kind: "reject", reason: "SIP_DOMAIN_MISMATCH" };
  }

  const from = parseSipUri(params.From);
  const fromCarrier = Boolean(params.SipSourceIp) && (config.carrierIps ?? []).includes(params.SipSourceIp);
  if (!domain || !from || from.host !== domain || fromCarrier) return { kind: "carrier" };

  if (!to || to.host !== domain) return { kind: "reject", reason: "DESTINATION_NOT_ON_DOMAIN" };
  return { kind: "endpoint", username: from.user, destination: toE164(to.user) };
}

/** Enough of a number to recognise it in a log, not enough to dial it. */
export const maskNumber = (value: string | null | undefined) =>
  value ? `${value.slice(0, 4)}…${value.slice(-2)}` : "";
