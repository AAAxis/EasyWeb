// Voice calling.
//
// The app already ships the native Twilio Voice SDK, so the server's job is
// only to mint access tokens and to accept call logs. When Twilio credentials
// are absent, `accessToken` reports it plainly rather than handing the client a
// token that will fail to register.
import { SignJWT } from "npm:jose@5.9.6";
import { env, has } from "../env.ts";

export type VoiceToken = {
  token: string;
  identity: string;
  /** Unix seconds. The client caches against this. */
  expiresAt: number;
};

export interface VoiceProvider {
  readonly name: string;
  readonly configured: boolean;
  accessToken(identity: string, creds?: import("./twilioAccount.ts").TwilioCreds, sandbox?: boolean): Promise<VoiceToken>;
}

const TTL_SECONDS = 3600;

const twilioProvider: VoiceProvider = {
  name: "twilio",
  get configured() {
    return has("TWILIO_ACCOUNT_SID") && has("TWILIO_API_KEY_SID") &&
      has("TWILIO_API_KEY_SECRET") && has("TWILIO_TWIML_APP_SID");
  },
  async accessToken(identity, creds, sandbox = false) {
    const accountSid = creds?.accountSid ?? env("TWILIO_ACCOUNT_SID");
    const keySid = creds?.apiKeySid || env("TWILIO_API_KEY_SID");
    const keySecret = creds?.apiKeySecret || env("TWILIO_API_KEY_SECRET");
    const appSid = creds?.twimlAppSid || env("TWILIO_TWIML_APP_SID");

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + TTL_SECONDS;

    // Without a push credential in the grant, Twilio has no way to wake the
    // app for an incoming call — the phone only rings while the app is open.
    // Debug builds register against APNs sandbox, store builds production.
    const pushCredentialSid = (sandbox
      ? creds?.pushCredentialSandboxSid
      : creds?.pushCredentialSid) ?? (creds?.own ? "" : env("TWILIO_PUSH_CREDENTIAL_SID"));
    const token = await new SignJWT({
      grants: {
        identity,
        voice: {
          incoming: { allow: true },
          outgoing: { application_sid: appSid },
          ...(pushCredentialSid ? { push_credential_sid: pushCredentialSid } : {}),
        },
      },
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" })
      .setIssuer(keySid)
      .setSubject(accountSid)
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .setJti(`${keySid}-${now}`)
      .sign(new TextEncoder().encode(keySecret));

    return { token, identity, expiresAt };
  },
};

export function voiceProvider(): VoiceProvider {
  return twilioProvider;
}
