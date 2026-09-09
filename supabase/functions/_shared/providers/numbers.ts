// Phone number provisioning through Twilio.
//
// Two ways a workspace gets a number, mirroring the classic dialler apps:
//   - Purchase: buy a Twilio number. It can make calls, receive calls (routed
//     to the owner's app by the twilio function) and receive SMS.
//   - Bind your own: verify an existing number as a Twilio Outgoing Caller ID.
//     Twilio calls it and reads a 6-digit code; once entered, outbound calls
//     may present it. Inbound stays on the person's own carrier — Twilio never
//     owns that line.
//
// Same shape as the other providers: unconfigured is a normal, reportable
// state, and every Twilio error surfaces with Twilio's own message.
import { env, has } from "../env.ts";
import { HttpError } from "../http.ts";

const BASE = "https://api.twilio.com/2010-04-01";

export const numbersConfigured = () =>
  has("TWILIO_ACCOUNT_SID") && has("TWILIO_AUTH_TOKEN");

// Which Twilio account to talk to: the workspace's own when passed, the
// platform's otherwise. Every function here threads this through.
export type NumberCreds = { accountSid: string; authToken: string; authUser?: string; bearer?: string };

const platformCreds = (): NumberCreds => ({
  accountSid: env("TWILIO_ACCOUNT_SID"),
  authToken: env("TWILIO_AUTH_TOKEN"),
});

const resolve = (creds?: NumberCreds): NumberCreds => {
  const chosen = creds ?? platformCreds();
  if (!chosen.accountSid || !chosen.authToken) {
    throw new HttpError(503, "Calling isn't configured on the server yet.", "VOICE_NOT_CONFIGURED");
  }
  return chosen;
};

const auth = (creds: NumberCreds) => ({
  Authorization: creds.bearer
    ? `Bearer ${creds.bearer}`
    : `Basic ${btoa(`${creds.authUser ?? creds.accountSid}:${creds.authToken}`)}`,
});

// The twilio function's public URL. Built from SUPABASE_URL, never req.url —
// see "A function cannot see its own public URL" in CLAUDE.md.
const twilioFunctionUrl = (route: string) =>
  `${env("SUPABASE_URL")}/functions/v1/twilio/${route}`;

async function twilioFetch(path: string, init: RequestInit | undefined, creds: NumberCreds) {
  const response = await fetch(`${BASE}/Accounts/${creds.accountSid}${path}`, {
    ...init,
    headers: { ...auth(creds), ...(init?.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(
      response.status === 404 ? 404 : 400,
      (data as { message?: string }).message ?? "Twilio rejected the request.",
      "TWILIO_ERROR",
    );
  }
  return data;
}

/** Local numbers available to buy, narrowed by digits or area code. */
export async function searchAvailable(country: string, contains: string | undefined, creds?: NumberCreds) {
  const resolved = resolve(creds);
  const params = new URLSearchParams({ VoiceEnabled: "true", SmsEnabled: "true" });
  if (contains) params.set("Contains", contains);
  const data = await twilioFetch(
    `/AvailablePhoneNumbers/${encodeURIComponent(country)}/Local.json?${params}`,
    undefined,
    resolved,
  ) as { available_phone_numbers?: Array<Record<string, unknown>> };
  return (data.available_phone_numbers ?? []).slice(0, 20).map((n) => ({
    phone_number: n.phone_number,
    friendly_name: n.friendly_name,
    locality: n.locality ?? null,
    region: n.region ?? null,
  }));
}

/**
 * Buy a number and point its webhooks at the twilio function, so inbound
 * calls ring the owner's app and inbound texts land in the workspace.
 */
export async function purchase(phoneNumber: string, creds?: NumberCreds) {
  const resolved = resolve(creds);
  const data = await twilioFetch(`/IncomingPhoneNumbers.json`, {
    method: "POST",
    body: new URLSearchParams({
      PhoneNumber: phoneNumber,
      VoiceUrl: twilioFunctionUrl("incoming"),
      VoiceMethod: "POST",
      SmsUrl: twilioFunctionUrl("sms"),
      SmsMethod: "POST",
    }),
  }, resolved) as { sid: string; phone_number: string };
  return { sid: data.sid, phone_number: data.phone_number };
}

/** Numbers the Twilio account already owns — migration fodder for claim(). */
export async function listOwned(creds?: NumberCreds) {
  const resolved = resolve(creds);
  const data = await twilioFetch(`/IncomingPhoneNumbers.json?PageSize=50`, undefined, resolved) as {
    incoming_phone_numbers?: Array<{ sid: string; phone_number: string; friendly_name?: string }>;
  };
  return (data.incoming_phone_numbers ?? []).map((n) => ({
    sid: n.sid,
    phone_number: n.phone_number,
    friendly_name: n.friendly_name ?? null,
  }));
}

/** Point an already-owned number's webhooks at this backend. */
export async function configureWebhooks(providerSid: string, creds?: NumberCreds) {
  const resolved = resolve(creds);
  await twilioFetch(`/IncomingPhoneNumbers/${providerSid}.json`, {
    method: "POST",
    body: new URLSearchParams({
      VoiceUrl: twilioFunctionUrl("incoming"),
      VoiceMethod: "POST",
      SmsUrl: twilioFunctionUrl("sms"),
      SmsMethod: "POST",
    }),
  }, resolved);
}

/** Release a purchased number back to Twilio. Irreversible. */
export async function release(providerSid: string, creds?: NumberCreds) {
  const resolved = resolve(creds);
  const response = await fetch(
    `${BASE}/Accounts/${resolved.accountSid}/IncomingPhoneNumbers/${providerSid}.json`,
    { method: "DELETE", headers: auth(resolved) },
  );
  if (!response.ok && response.status !== 404) {
    throw new HttpError(400, "Twilio couldn't release the number.", "TWILIO_ERROR");
  }
}

/**
 * Start verifying the person's own number as an outbound caller ID. Twilio
 * calls the number immediately; the returned code is what the robot asks for.
 * The twilio function's `callerid` route hears about the outcome.
 */
export async function startCallerIdVerification(phoneNumber: string, orgId: number, creds?: NumberCreds) {
  const resolved = resolve(creds);
  const data = await twilioFetch(`/OutgoingCallerIds.json`, {
    method: "POST",
    body: new URLSearchParams({
      PhoneNumber: phoneNumber,
      StatusCallback: twilioFunctionUrl("callerid") + `?org=${orgId}`,
      StatusCallbackMethod: "POST",
    }),
  }, resolved) as { validation_code: string; phone_number: string };
  return { validation_code: data.validation_code, phone_number: data.phone_number };
}
