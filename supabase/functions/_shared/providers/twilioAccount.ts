// A workspace's own Twilio account — the second way to get phone service.
//
// Connecting stores the account's credentials and provisions, inside THEIR
// account, the two things app calling needs: an API key (voice access tokens)
// and a TwiML app pointing at our voice webhook. From then on, credsFor()
// hands every Twilio-touching feature the right credentials: the workspace's
// own when connected, the platform's otherwise.
import { sql } from "../db.ts";
import { env, has } from "../env.ts";
import { HttpError } from "../http.ts";

const BASE = "https://api.twilio.com/2010-04-01";

export type TwilioCreds = {
  accountSid: string;
  authToken: string;
  /** OAuth-authorized accounts speak Bearer instead of Basic. */
  bearer?: string;
  /**
   * Who the Basic auth speaks as. For pasted credentials it's the account
   * itself; for Twilio Connect it's the platform account, authorized to act
   * on `accountSid`. numbers/sms use this when set.
   */
  authUser?: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  pushCredentialSid?: string;
  pushCredentialSandboxSid?: string;
  /** true when these are the workspace's own credentials, not the platform's. */
  own: boolean;
};

const basic = (sid: string, token: string) => ({
  Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
});

const twilioFunctionUrl = (route: string) =>
  `${env("SUPABASE_URL")}/functions/v1/twilio/${route}`;

/**
 * VoIP push credentials, created inside the connected account from the
 * platform's Apple VoIP certificate. Sandbox and production are separate
 * APNs environments, so both exist; the voice token picks by build type.
 * Best-effort — an account that can't take them still gets calls while the
 * app is foregrounded.
 */
export async function ensurePushCredentials(orgId: number): Promise<void> {
  const row = await accountRow(orgId);
  if (!row || (row.push_credential_sid && row.push_credential_sandbox_sid)) return;

  const cert = atob(env("TWILIO_VOIP_CERT_B64") || "");
  const key = atob(env("TWILIO_VOIP_KEY_B64") || "");
  if (!cert || !key) return;

  const viaConnect = Boolean(row.via_connect);
  const authUser = viaConnect ? env("TWILIO_ACCOUNT_SID") : String(row.account_sid);
  const authSecret = viaConnect ? env("TWILIO_AUTH_TOKEN") : String(row.auth_token);

  const create = async (sandbox: boolean) => {
    const response = await fetch("https://notify.twilio.com/v1/Credentials", {
      method: "POST",
      headers: {
        ...basic(authUser, authSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        FriendlyName: sandbox ? "EasyDeck VoIP (sandbox)" : "EasyDeck VoIP",
        Type: "apn",
        Certificate: cert,
        PrivateKey: key,
        Sandbox: String(sandbox),
      }),
    });
    const body = await response.json().catch(() => ({})) as { sid?: string; message?: string };
    if (!response.ok || !body.sid) {
      console.warn("push credential create failed:", body.message ?? response.status);
      return null;
    }
    return body.sid;
  };

  const production = row.push_credential_sid ?? await create(false);
  const sandbox = row.push_credential_sandbox_sid ?? await create(true);
  await sql`
    update app_private.twilio_accounts
       set push_credential_sid = ${production},
           push_credential_sandbox_sid = ${sandbox}
     where id = ${row.id}
  `;
}

export async function accountRow(orgId: number) {
  const [row] = await sql`
    select * from app_private.twilio_accounts where org_id = ${orgId}`;
  return row ?? null;
}

export async function rowByAccountSid(accountSid: string) {
  const [row] = await sql`
    select * from app_private.twilio_accounts where account_sid = ${accountSid} limit 1`;
  return row ?? null;
}

const TOKEN_URL = "https://oauth.twilio.com/v2/token";

/** A live OAuth access token, refreshed when close to expiring. */
async function bearerFor(row: Record<string, unknown>): Promise<string> {
  const expires = row.token_expires_at ? new Date(String(row.token_expires_at)).getTime() : 0;
  if (row.access_token && expires > Date.now() + 60_000) return String(row.access_token);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: String(row.refresh_token ?? ""),
      client_id: env("TWILIO_OAUTH_CLIENT_ID"),
      client_secret: env("TWILIO_OAUTH_CLIENT_SECRET"),
    }),
  });
  const body = await response.json().catch(() => ({})) as {
    access_token?: string; refresh_token?: string; expires_in?: number;
  };
  if (!response.ok || !body.access_token) {
    throw new HttpError(401, "Twilio access expired — reconnect the account.", "TWILIO_REAUTH");
  }
  await sql`
    update app_private.twilio_accounts
       set access_token = ${body.access_token},
           refresh_token = ${body.refresh_token ?? row.refresh_token},
           token_expires_at = ${new Date(Date.now() + (body.expires_in ?? 3600) * 1000)}
     where id = ${row.id}
  `;
  return body.access_token;
}

/** The credentials every Twilio call should use for this workspace. */
export async function credsFor(orgId: number): Promise<TwilioCreds | null> {
  const row = await accountRow(orgId);
  if (row) {
    const viaOauth = Boolean(row.refresh_token);
    const viaConnect = Boolean(row.via_connect) && !viaOauth;
    return {
      accountSid: String(row.account_sid),
      authToken: viaConnect ? env("TWILIO_AUTH_TOKEN") : String(row.auth_token ?? ""),
      authUser: viaConnect ? env("TWILIO_ACCOUNT_SID") : undefined,
      bearer: viaOauth ? await bearerFor(row) : undefined,
      apiKeySid: String(row.api_key_sid ?? ""),
      apiKeySecret: String(row.api_key_secret ?? ""),
      twimlAppSid: String(row.twiml_app_sid ?? ""),
      pushCredentialSid: row.push_credential_sid ? String(row.push_credential_sid) : undefined,
      pushCredentialSandboxSid: row.push_credential_sandbox_sid ? String(row.push_credential_sandbox_sid) : undefined,
      own: true,
    };
  }
  if (!has("TWILIO_ACCOUNT_SID")) return null;
  return {
    accountSid: env("TWILIO_ACCOUNT_SID"),
    authToken: env("TWILIO_AUTH_TOKEN"),
    apiKeySid: env("TWILIO_API_KEY_SID"),
    apiKeySecret: env("TWILIO_API_KEY_SECRET"),
    twimlAppSid: env("TWILIO_TWIML_APP_SID"),
    own: false,
  };
}

// --- OAuth (authorization-code) flow ---------------------------------------

const stateKey = async () =>
  await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env("SUPABASE_SERVICE_ROLE_KEY")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

export async function signState(orgId: number) {
  const body = btoa(JSON.stringify({ orgId, at: Date.now() }));
  const mac = hex(await crypto.subtle.sign("HMAC", await stateKey(), new TextEncoder().encode(body)));
  return `${body}.${mac}`;
}

export async function readState(state: string): Promise<number> {
  const [body, mac] = String(state).split(".");
  if (!body || !mac) throw new HttpError(400, "Bad state", "BAD_STATE");
  const expected = hex(await crypto.subtle.sign("HMAC", await stateKey(), new TextEncoder().encode(body)));
  if (expected !== mac) throw new HttpError(400, "Bad state", "BAD_STATE");
  const parsed = JSON.parse(atob(body)) as { orgId: number; at: number };
  if (Date.now() - parsed.at > 10 * 60 * 1000) throw new HttpError(400, "That link expired", "STATE_EXPIRED");
  return parsed.orgId;
}

export const redirectUri = () =>
  `${env("SUPABASE_URL")}/functions/v1/twilio-oauth/callback`;

/** The Twilio sign-in-and-approve page, with the workspace riding in state. */
export async function authorizeUrl(orgId: number) {
  const clientId = env("TWILIO_OAUTH_CLIENT_ID");
  if (!clientId) {
    throw new HttpError(503, "Twilio OAuth isn't configured on the server yet.", "NO_OAUTH_APP");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "offline_access",
    redirect_uri: redirectUri(),
    state: await signState(orgId),
  });
  return `https://oauth.twilio.com/v2/authorize?${params}`;
}

/**
 * Completes the OAuth callback: code → tokens, find the account, provision
 * the API key and TwiML app with the Bearer token, store everything.
 */
export async function completeOauth(code: string, orgId: number) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env("TWILIO_OAUTH_CLIENT_ID"),
      client_secret: env("TWILIO_OAUTH_CLIENT_SECRET"),
      redirect_uri: redirectUri(),
    }),
  });
  const tokens = await response.json().catch(() => ({})) as {
    access_token?: string; refresh_token?: string; expires_in?: number;
  };
  if (!response.ok || !tokens.access_token) {
    throw new HttpError(502, "Twilio rejected the authorization code.", "TWILIO_OAUTH_FAILED");
  }

  // Whose account is this? The token can list the accounts it reaches.
  const accountsResponse = await fetch(`${BASE}/Accounts.json?PageSize=1`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const accounts = await accountsResponse.json().catch(() => ({})) as {
    accounts?: Array<{ sid: string }>;
  };
  const accountSid = accounts.accounts?.[0]?.sid;
  if (!accountsResponse.ok || !accountSid) {
    throw new HttpError(502, "Couldn't read the authorized Twilio account.", "TWILIO_OAUTH_FAILED");
  }

  const provisioned = await provisionBearer(accountSid, tokens.access_token);
  await sql`
    insert into app_private.twilio_accounts ${sql({
      org_id: orgId,
      account_sid: accountSid,
      auth_token: null,
      via_connect: true,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      ...provisioned,
    })}
    on conflict (org_id) do update
      set account_sid = excluded.account_sid,
          auth_token = null,
          via_connect = true,
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          token_expires_at = excluded.token_expires_at,
          api_key_sid = excluded.api_key_sid,
          api_key_secret = excluded.api_key_secret,
          twiml_app_sid = excluded.twiml_app_sid
  `;
  return { account_sid: accountSid };
}

/** API key + TwiML app inside the account, authenticated by Bearer. */
async function provisionBearer(targetSid: string, bearer: string) {
  const headers = {
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const keyResponse = await fetch(`${BASE}/Accounts/${targetSid}/Keys.json`, {
    method: "POST",
    headers,
    body: new URLSearchParams({ FriendlyName: "EasyDeck" }),
  });
  const key = await keyResponse.json().catch(() => ({}));
  if (!keyResponse.ok) {
    throw new HttpError(400, (key as { message?: string }).message ?? "Couldn't create an API key.", "TWILIO_ERROR");
  }
  const appResponse = await fetch(`${BASE}/Accounts/${targetSid}/Applications.json`, {
    method: "POST",
    headers,
    body: new URLSearchParams({
      FriendlyName: "EasyDeck",
      VoiceUrl: twilioFunctionUrl("voice"),
      VoiceMethod: "POST",
      SmsUrl: twilioFunctionUrl("sms"),
      SmsMethod: "POST",
    }),
  });
  const app = await appResponse.json().catch(() => ({}));
  if (!appResponse.ok) {
    throw new HttpError(400, (app as { message?: string }).message ?? "Couldn't create the TwiML app.", "TWILIO_ERROR");
  }
  return {
    api_key_sid: (key as { sid: string }).sid,
    api_key_secret: (key as { secret: string }).secret,
    twiml_app_sid: (app as { sid: string }).sid,
  };
}

/** API key + TwiML app inside the target account, whoever authenticates. */
async function provision(targetSid: string, authUser: string, authSecret: string) {
  const headers = {
    ...basic(authUser, authSecret),
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const keyResponse = await fetch(`${BASE}/Accounts/${targetSid}/Keys.json`, {
    method: "POST",
    headers,
    body: new URLSearchParams({ FriendlyName: "EasyDeck" }),
  });
  const key = await keyResponse.json().catch(() => ({}));
  if (!keyResponse.ok) {
    throw new HttpError(400, (key as { message?: string }).message ?? "Couldn't create an API key.", "TWILIO_ERROR");
  }
  const appResponse = await fetch(`${BASE}/Accounts/${targetSid}/Applications.json`, {
    method: "POST",
    headers,
    body: new URLSearchParams({
      FriendlyName: "EasyDeck",
      VoiceUrl: twilioFunctionUrl("voice"),
      VoiceMethod: "POST",
      SmsUrl: twilioFunctionUrl("sms"),
      SmsMethod: "POST",
    }),
  });
  const app = await appResponse.json().catch(() => ({}));
  if (!appResponse.ok) {
    throw new HttpError(400, (app as { message?: string }).message ?? "Couldn't create the TwiML app.", "TWILIO_ERROR");
  }
  return {
    api_key_sid: (key as { sid: string }).sid,
    api_key_secret: (key as { secret: string }).secret,
    twiml_app_sid: (app as { sid: string }).sid,
  };
}

/**
 * Finishes the Connect flow: the code from the authorize callback names the
 * account; the platform's credentials (now authorized on it) provision the
 * key and TwiML app, and no token of theirs is ever stored.
 */
export async function claim(orgId: number, code: string) {
  const [pending] = await sql`
    select account_sid from app_private.twilio_connect_pending
     where code = ${code.trim()} and created_at > now() - interval '15 minutes'
  `;
  if (!pending) throw new HttpError(404, "That code isn't valid — authorize again and use the fresh one.", "BAD_CODE");
  await sql`delete from app_private.twilio_connect_pending where code = ${code.trim()}`;

  const accountSid = String(pending.account_sid);
  const platformSid = env("TWILIO_ACCOUNT_SID");
  const platformToken = env("TWILIO_AUTH_TOKEN");

  // Prove the authorization actually landed before storing anything.
  const check = await fetch(`${BASE}/Accounts/${accountSid}.json`, {
    headers: basic(platformSid, platformToken),
  });
  if (!check.ok) {
    throw new HttpError(401, "Twilio hasn't granted access to that account.", "CONNECT_NOT_AUTHORIZED");
  }

  const provisioned = await provision(accountSid, platformSid, platformToken);
  const [row] = await sql`
    insert into app_private.twilio_accounts ${sql({
      org_id: orgId,
      account_sid: accountSid,
      auth_token: null,
      via_connect: true,
      ...provisioned,
    })}
    on conflict (org_id) do update
      set account_sid = excluded.account_sid,
          auth_token = null,
          via_connect = true,
          api_key_sid = excluded.api_key_sid,
          api_key_secret = excluded.api_key_secret,
          twiml_app_sid = excluded.twiml_app_sid
    returning account_sid
  `;
  return { account_sid: String(row.account_sid) };
}

/**
 * Connects a workspace's Twilio account: verifies the credentials, then
 * provisions an API key and a TwiML app inside that account so calling works
 * without any console visit.
 */
export async function connect(orgId: number, accountSid: string, authToken: string) {
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) {
    throw new HttpError(400, "That doesn't look like an Account SID (starts with AC…).", "BAD_SID");
  }

  // Prove the pair works before storing anything.
  const check = await fetch(`${BASE}/Accounts/${accountSid}.json`, {
    headers: basic(accountSid, authToken),
  });
  if (!check.ok) {
    throw new HttpError(401, "Twilio rejected those credentials.", "TWILIO_AUTH_FAILED");
  }

  // An API key of their own, for voice access tokens.
  const keyResponse = await fetch(`${BASE}/Accounts/${accountSid}/Keys.json`, {
    method: "POST",
    headers: { ...basic(accountSid, authToken), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ FriendlyName: "EasyDeck" }),
  });
  const key = await keyResponse.json().catch(() => ({}));
  if (!keyResponse.ok) {
    throw new HttpError(400, (key as { message?: string }).message ?? "Couldn't create an API key.", "TWILIO_ERROR");
  }

  // A TwiML app of their own, pointed at our voice webhook.
  const appResponse = await fetch(`${BASE}/Accounts/${accountSid}/Applications.json`, {
    method: "POST",
    headers: { ...basic(accountSid, authToken), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      FriendlyName: "EasyDeck",
      VoiceUrl: twilioFunctionUrl("voice"),
      VoiceMethod: "POST",
      SmsUrl: twilioFunctionUrl("sms"),
      SmsMethod: "POST",
    }),
  });
  const app = await appResponse.json().catch(() => ({}));
  if (!appResponse.ok) {
    throw new HttpError(400, (app as { message?: string }).message ?? "Couldn't create the TwiML app.", "TWILIO_ERROR");
  }

  const [row] = await sql`
    insert into app_private.twilio_accounts ${sql({
      org_id: orgId,
      account_sid: accountSid,
      auth_token: authToken,
      api_key_sid: (key as { sid: string }).sid,
      api_key_secret: (key as { secret: string }).secret,
      twiml_app_sid: (app as { sid: string }).sid,
    })}
    on conflict (org_id) do update
      set account_sid = excluded.account_sid,
          auth_token = excluded.auth_token,
          api_key_sid = excluded.api_key_sid,
          api_key_secret = excluded.api_key_secret,
          twiml_app_sid = excluded.twiml_app_sid
    returning account_sid
  `;
  return { account_sid: String(row.account_sid) };
}

export async function disconnect(orgId: number) {
  await sql`delete from app_private.twilio_accounts where org_id = ${orgId}`;
}

/** Masked status for the settings screen. */
export async function status(orgId: number) {
  const row = await accountRow(orgId);
  return {
    connected: Boolean(row),
    account_sid: row ? `${String(row.account_sid).slice(0, 8)}…${String(row.account_sid).slice(-4)}` : null,
  };
}
