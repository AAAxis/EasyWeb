// Outbound SMS through Twilio.
//
// Same shape as the voice and email providers: unconfigured is a normal state
// that reports itself, not an exception thrown from somewhere deep.
import { env, has } from "../env.ts";

export type OutboundSms = { to: string; from?: string; body: string };

export type SmsResult = {
  provider: string;
  providerMessageId: string | null;
  status: "sent" | "queued" | "failed";
  error?: string;
};

export const smsConfigured = () =>
  has("TWILIO_ACCOUNT_SID") && has("TWILIO_AUTH_TOKEN") &&
  (has("TWILIO_SMS_FROM") || has("TWILIO_CALLER_ID"));

export async function sendSms(
  message: OutboundSms,
  creds?: { accountSid: string; authToken: string; authUser?: string; bearer?: string; own?: boolean },
): Promise<SmsResult> {
  const accountSid = creds?.accountSid ?? env("TWILIO_ACCOUNT_SID");
  const authToken = creds?.authToken ?? env("TWILIO_AUTH_TOKEN");
  const authUser = creds?.authUser ?? accountSid;
  const authHeader = creds?.bearer
    ? `Bearer ${creds.bearer}`
    : `Basic ${btoa(`${authUser}:${authToken}`)}`;
  // A messaging-capable number; the platform fallbacks only apply on the
  // platform account — a connected account sends from its own numbers.
  const from = message.from ||
    (creds?.own ? "" : env("TWILIO_SMS_FROM") || env("TWILIO_CALLER_ID"));

  if (!accountSid || (!authToken && !creds?.bearer) || !from) {
    return {
      provider: "twilio",
      providerMessageId: null,
      status: "failed",
      error: "Texting isn't configured for this workspace yet.",
    };
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: message.to, From: from, Body: message.body }),
    },
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      provider: "twilio",
      providerMessageId: null,
      status: "failed",
      error: (body as { message?: string }).message ?? `Twilio returned ${response.status}`,
    };
  }

  return {
    provider: "twilio",
    providerMessageId: (body as { sid?: string }).sid ?? null,
    status: "sent",
  };
}
