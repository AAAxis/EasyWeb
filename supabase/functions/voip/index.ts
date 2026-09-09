// The VoIP API — /functions/v1/voip/*
//
// Calls, the numbers they go out on, what was recorded, and SMS. Every route
// runs the same three steps the CRM's API does: verify the Firebase token,
// resolve the org the caller is acting in, then hand a proven orgId to the
// data layer. No handler ever reads an org id straight off the request.
//
// It deploys into the same Supabase project as the CRM and writes the same
// tables, which is the whole point: a call still lands on the contact's
// timeline and an SMS still shows up in the CRM's inbox. What moved out is the
// code, not the data.
import { requireAdmin, requireOrg, requireUser } from "../_shared/auth.ts";
import {
  HttpError,
  json,
  noContent,
  parseLimit,
  readJson,
  Router,
  toErrorResponse,
} from "../_shared/http.ts";
import { contacts, numbers, orgs } from "../_shared/repository.ts";
import {
  configureWebhooks, listOwned, numbersConfigured, purchase as purchaseNumber,
  release as releaseNumber, searchAvailable, startCallerIdVerification,
} from "../_shared/providers/numbers.ts";
import {
  authorizeUrl as twilioAuthorizeUrl, claim as claimTwilio,
  connect as connectTwilio, credsFor as twilioCredsFor,
  disconnect as disconnectTwilio, status as twilioStatus,
  balance as twilioBalance,
} from "../_shared/providers/twilioAccount.ts";
import { calls, conversations, recordings } from "../_shared/activity.ts";
import { playbackUrl, recordingConfigured, removeObject } from "../_shared/providers/recordings.ts";
import { voiceProvider } from "../_shared/providers/voice.ts";
import * as didlogic from "../_shared/providers/didlogic.ts";
import * as oxapay from "../_shared/providers/oxapay.ts";
import { broadcast, broadcastToOrg } from "../_shared/realtime.ts";
import { sql } from "../_shared/db.ts";

// An optional positive number off the query string — a cursor, a contact id.
// Anything else reads as "not given" rather than as zero.
const int = (value: string | null | undefined): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

// A path segment that has to be a number. Router params arrive as strings, and
// a bad one belongs in a 400 rather than in a query.
const requireInt = (value: string, what: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, `Invalid ${what}`, "INVALID_ID");
  return parsed;
};

const router = new Router();

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

// Which carrier this workspace is on.
//
// DIDLogic is the house carrier: it is the platform's account, not something a
// workspace connects, so its key lives in the environment and every workspace
// gets it without being asked. A row only exists when there is something
// workspace-specific to remember — which number is active, or a Twilio account
// of their own — and the key is read from the row only if it has one.
async function carrierFor(orgId: number) {
  const [row] = await sql`
    select provider, credentials, active_number from app_private.number_providers
     where org_id = ${orgId}`;
  const house = Deno.env.get("DIDLOGIC_API_KEY") ?? "";
  if (!row) {
    return house
      ? { provider: "didlogic", credentials: { api_key: house }, active_number: null, managed: true }
      : null;
  }
  if (row.provider === "didlogic" && !(row.credentials as { api_key?: string })?.api_key) {
    return { ...row, credentials: { api_key: house }, managed: true };
  }
  return { ...row, managed: false };
}

/** `"dima" <6531061544>` — the label is theirs, the number is the part we want. */
const bareNumber = (value: string) => {
  const match = /<([^>]+)>/.exec(value ?? "");
  return (match ? match[1] : value ?? "").trim();
};

router.add("GET /calls", async ({ req, query }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req, query);

  // The carrier's own record when there is one. For a DIDLogic account it is
  // the truer answer: what was actually carried and actually billed, where our
  // table only knows what the app told it before the call connected — which is
  // why every row in it says in_progress with no duration.
  const carrier = await carrierFor(ctx.orgId);
  if (carrier?.provider === "didlogic") {
    const key = (carrier.credentials as { api_key?: string })?.api_key ?? "";
    // Whose numbers these are has to come from the carrier too. Reading it from
    // our own phone_numbers table meant the set was empty for a DIDLogic
    // account, and every call it placed was labelled inbound.
    const [rows, held] = await Promise.all([didlogic.calls(key), didlogic.numbers(key).catch(() => [])]);
    const owned = new Set(held.map((n) => String(n.number).replace(/^\+/, "")));
    // Narrowed to the number being worked on, when one is chosen. Comparing
    // without the leading + because the carrier is inconsistent about it.
    const active = String(carrier.active_number ?? "").replace(/^\+/, "");
    const mine = active
      ? rows.filter((c) =>
        bareNumber(c.from).replace(/^\+/, "") === active || bareNumber(c.to).replace(/^\+/, "") === active)
      : rows;
    return json({
      source: "didlogic",
      active_number: carrier.active_number ?? null,
      calls: mine.map((c, i) => {
        const from = bareNumber(c.from);
        const to = bareNumber(c.to);
        const seconds = Number(c.duration ?? 0);
        return {
          id: `dl-${i}-${c.timestamp}`,
          direction: owned.has(from.replace(/^\+/, "")) ? "outbound" : "inbound",
          from_number: from,
          to_number: to,
          duration_seconds: seconds,
          status: seconds > 0 ? "completed" : "no_answer",
          started_at: c.timestamp,
          contact_name: c.destination_name ?? null,
          amount: c.amount,
        };
      }),
    });
  }

  return json({
    calls: await calls.list(ctx.orgId, {
      contactId: int(query.get("contact_id")),
      userId: query.get("mine") === "1" ? actor.uid : undefined,
      cursor: int(query.get("before_id")),
      limit: parseLimit(query),
    }),
  });
});

router.add("POST /calls", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  const call = await calls.log(ctx.orgId, actor.uid, await readJson(req));
  return json({ call }, 201);
});

// Registered before /calls/:id so the literal segment wins the match.
router.add("PATCH /calls/by-sid/:sid", async ({ req, params }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  return json({ call: await calls.updateBySid(ctx.orgId, params.sid, await readJson(req), actor.uid) });
});

router.add("PATCH /calls/:id", async ({ req, params }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  return json({ call: await calls.update(ctx.orgId, requireInt(params.id, "call id"), await readJson(req)) });
});

// Chatwoot identity validation: HMAC of the identifier with the inbox's
// secret key. Computed here so the key never ships inside the app.

// ---------------------------------------------------------------------------
// The token the phone dials with, and the Twilio account behind it
// ---------------------------------------------------------------------------


router.add("POST /voice/token", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  const provider = voiceProvider();
  const { ensurePushCredentials } = await import("../_shared/providers/twilioAccount.ts");
  await ensurePushCredentials(ctx.orgId).catch(() => {});
  const creds = await twilioCredsFor(ctx.orgId);
  if (!creds?.own) {
    throw new HttpError(
      503,
      "Connect your Twilio account in Settings → Phone number to enable calling.",
      "NO_TWILIO_ACCOUNT",
    );
  }
  const body = await readJson<{ sandbox?: boolean }>(req).catch(() => ({}));
  return json(await provider.accessToken(actor.uid, creds, Boolean(body.sandbox)));
});

// --- Bring-your-own Twilio ------------------------------------------------

router.add("GET /twilio/account", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  // The balance rides along with the status the settings screen already asks
  // for, rather than as a second round trip for one number. It is null when
  // there is nothing to ask — no account, or one connected by OAuth, whose
  // token the Balance resource will not take.
  const [status, funds] = await Promise.all([
    twilioStatus(ctx.orgId),
    twilioBalance(ctx.orgId),
  ]);
  return json({ ...status, balance: funds?.balance ?? null, currency: funds?.currency ?? null });
});

router.add("POST /twilio/account", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  requireAdmin(ctx);
  const body = await readJson<{ account_sid?: string; auth_token?: string }>(req);
  if (!body.account_sid?.trim() || !body.auth_token?.trim()) {
    throw new HttpError(400, "Account SID and auth token are both required.", "MISSING_CREDS");
  }
  return json(await connectTwilio(ctx.orgId, body.account_sid.trim(), body.auth_token.trim()), 201);
});

router.add("GET /twilio/connect", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  requireAdmin(ctx);
  const { signState } = await import("../_shared/providers/twilioAccount.ts");
  const state = await signState(ctx.orgId);
  return json({ url: `https://pay.chatkit.cc/twilio-connect?state=${encodeURIComponent(state)}` });
});

router.add("POST /twilio/account/claim", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  requireAdmin(ctx);
  const body = await readJson<{ code?: string }>(req);
  if (!body.code?.trim()) throw new HttpError(400, "The code from the Twilio page is required.", "CODE_REQUIRED");
  return json(await claimTwilio(ctx.orgId, body.code), 201);
});

router.add("DELETE /twilio/account", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  requireAdmin(ctx);
  await disconnectTwilio(ctx.orgId);
  return json({ connected: false });
});

// Numbers already sitting in the connected account, ready to import.

// The number this workspace is working on.
//
// A carrier account can hold several, and history is only useful when it is
// about one of them: "my calls" means calls on the number I am using, not every
// call the account ever carried.
router.add("POST /providers/active", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  requireAdmin(ctx);
  const body = await readJson<{ number?: string | null }>(req);
  const number = body.number === null ? null : String(body.number ?? "").trim() || null;
  const carrier = await carrierFor(ctx.orgId);
  if (!carrier) throw new HttpError(409, "No carrier connected", "NO_PROVIDER");
  // A workspace on the house carrier has no row until it wants something
  // remembered. This is that moment — and the key stays out of it, because it
  // belongs to the platform.
  const [row] = await sql`
    insert into app_private.number_providers (org_id, provider, credentials, label, active_number, connected_by)
    values (${ctx.orgId}, ${carrier.provider}, '{}'::jsonb, 'Included', ${number}, ${actor.uid})
    on conflict (org_id) do update set active_number = excluded.active_number
    returning provider, label, connected_at, active_number`;
  return json({ provider: row });
});

// Texts the carrier has a record of, for the SMS screen.
router.add("GET /providers/sms", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  const carrier = await carrierFor(ctx.orgId);
  if (carrier?.provider !== "didlogic") return json({ messages: [] });
  const key = (carrier.credentials as { api_key?: string })?.api_key ?? "";
  const active = String(carrier.active_number ?? "").replace(/^\+/, "");
  const all = await didlogic.sms(key);
  const mine = active
    ? all.filter((m) => JSON.stringify(m).includes(active))
    : all;
  return json({ messages: mine, active_number: carrier.active_number ?? null });
});

// ---------------------------------------------------------------------------
// Where numbers come from
//
// One carrier at a time. That is a trunk, not a list of integrations: two
// connected at once means every outbound call has a question to answer about
// which one it leaves by. The primary key on org_id enforces it, so swapping is
// disconnect-then-connect — a deliberate moment rather than a silent re-route.
// ---------------------------------------------------------------------------

const PROVIDERS = ["twilio", "didlogic"];

router.add("GET /providers", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  const [row] = await sql`
    select provider, label, connected_at, active_number from app_private.number_providers
     where org_id = ${ctx.orgId}`;
  const carrier = await carrierFor(ctx.orgId);
  return json({
    provider: row ?? (carrier
      ? { provider: carrier.provider, label: "Included", connected_at: null, active_number: null }
      : null),
    // Managed means the platform's own account: nothing to connect, nothing to
    // disconnect, and no key for anyone to paste.
    managed: Boolean(carrier?.managed),
    // Only what a workspace can actually bring itself.
    choices: PROVIDERS.filter((name) => name !== "didlogic"),
  });
});

router.add("POST /providers", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  requireAdmin(ctx);
  const body = await readJson<{ provider?: string; api_key?: string; account_sid?: string; auth_token?: string }>(req);
  const provider = String(body.provider ?? "").trim().toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    throw new HttpError(400, `provider must be one of ${PROVIDERS.join(", ")}`, "BAD_PROVIDER");
  }

  // Refused rather than replaced. Swapping carriers silently is how a
  // workspace's calls change route without anyone deciding to.
  const [existing] = await sql`
    select provider from app_private.number_providers where org_id = ${ctx.orgId}`;
  if (existing) {
    throw new HttpError(
      409,
      `${existing.provider} is connected. Disconnect it first — only one carrier at a time.`,
      "ALREADY_CONNECTED",
    );
  }

  let credentials: Record<string, string> = {};
  let label = provider;
  if (provider === "didlogic") {
    const key = String(body.api_key ?? "").trim();
    if (!key) throw new HttpError(400, "api_key is required", "MISSING_KEY");
    // Proven before it is stored: a key that does not work should fail here,
    // not on the first call somebody tries to place.
    const check = await didlogic.verify(key);
    credentials = { api_key: key };
    label = `DIDLogic · ${check.sipAccounts} trunk${check.sipAccounts === 1 ? "" : "s"}`;
  } else {
    const sid = String(body.account_sid ?? "").trim();
    const token = String(body.auth_token ?? "").trim();
    if (!sid || !token) throw new HttpError(400, "account_sid and auth_token are required", "MISSING_KEY");
    credentials = { account_sid: sid, auth_token: token };
    label = `Twilio · ${sid.slice(0, 10)}…`;
  }

  const [row] = await sql`
    insert into app_private.number_providers (org_id, provider, credentials, label, connected_by)
    values (${ctx.orgId}, ${provider}, ${sql.json(credentials)}, ${label}, ${actor.uid})
    returning provider, label, connected_at`;
  return json({ provider: row }, 201);
});

router.add("DELETE /providers", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  requireAdmin(ctx);
  await sql`delete from app_private.number_providers where org_id = ${ctx.orgId}`;
  return noContent();
});

// What is left to spend. The dashboard asks for this; the phone app does not —
// a balance is an operator's number, not something to put in front of someone
// mid-call.
router.add("GET /providers/balance", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  const carrier = await carrierFor(ctx.orgId);
  if (!carrier) throw new HttpError(409, "No carrier connected", "NO_PROVIDER");
  if (carrier.provider !== "didlogic") return json({ balance: null, provider: carrier.provider });
  const key = (carrier.credentials as { api_key?: string })?.api_key ?? "";
  return json({ provider: carrier.provider, balance: await didlogic.balance(key) });
});

// ---------------------------------------------------------------------------
// Balance
//
// The crypto float, read straight from OxaPay. There is no wallet table behind
// this: OxaPay holds the money and the history of it, and a second copy here
// would be a second thing to keep true.
//
// One OxaPay account stands behind the whole install — the key is an
// environment secret, not a per-workspace credential like the carrier's. So
// this is the operator's own float, and the same figure whoever asks. That is
// correct while EasyCall is one operator's console, and is the thing to revisit
// first if it ever is not.
// ---------------------------------------------------------------------------

router.add("GET /balance", async ({ req }) => {
  const actor = await requireUser(req);
  await requireOrg(actor, req);
  if (!oxapay.configured()) return json({ connected: false, held: [] });
  return json({ connected: true, ...(await oxapay.balance()) });
});

// Mints a hosted OxaPay page and hands back its URL. The payer chooses the coin
// there; nothing on this side needs to know which, or to hear how it went — the
// money lands in the account the balance route reads.
router.add("POST /balance/topup", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  const body = await readJson(req);
  const invoice = await oxapay.topUp(Number(body.amount), {
    orgId: ctx.orgId,
    returnUrl: body.return_url,
  });
  return json(invoice, 201);
});

// The trunks calls leave by, for the carrier that has them.
router.add("GET /providers/trunks", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  const carrier = await carrierFor(ctx.orgId);
  if (carrier?.provider !== "didlogic") return json({ trunks: [] });
  const key = (carrier.credentials as { api_key?: string })?.api_key ?? "";
  return json({ trunks: await didlogic.sipAccounts(key) });
});

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------


router.add("GET /numbers/importable", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  const creds = await twilioCredsFor(ctx.orgId);
  if (!creds?.own) return json({ numbers: [] });
  const owned = await listOwned(creds);
  const linked = await numbers.list(ctx.orgId);
  const linkedSet = new Set(linked.map((n) => String(n.phone_number)));
  return json({ numbers: owned.filter((n) => !linkedSet.has(n.phone_number)) });
});

router.add("POST /numbers/import", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  requireAdmin(ctx);
  const creds = await twilioCredsFor(ctx.orgId);
  if (!creds?.own) throw new HttpError(409, "Connect your Twilio account first.", "NO_TWILIO_ACCOUNT");
  const body = await readJson<{ phone_number?: string }>(req);
  const owned = await listOwned(creds);
  const match = owned.find((n) => n.phone_number === body.phone_number);
  if (!match) throw new HttpError(404, "That number isn't in the connected account.", "NOT_FOUND");
  await configureWebhooks(match.sid, creds);
  const row = await numbers.add(ctx.orgId, {
    user_id: actor.uid,
    phone_number: match.phone_number,
    label: match.friendly_name,
    provider_sid: match.sid,
    is_verified: true,
  });
  return json({ number: row }, 201);
});

// --- Phone numbers -------------------------------------------------------
//
// The two ways a workspace gets a line: buy a Twilio number (full two-way
// calling and SMS), or verify a number it already owns as outbound caller ID.

router.add("GET /numbers", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);

  // The same question, whichever carrier is connected: what numbers do I have?
  // A caller should not have to know who sells them.
  const carrier = await carrierFor(ctx.orgId);
  if (carrier?.provider === "didlogic") {
    const key = (carrier.credentials as { api_key?: string })?.api_key ?? "";
    const held = await didlogic.numbers(key);
    return json({
      numbers: held.map((n) => ({
        id: n.id ?? n.number,
        phone_number: n.number.startsWith("+") ? n.number : `+${n.number}`,
        label: [n.country, n.area].filter(Boolean).join(" · ") || null,
        is_primary: false,
        verified: true,
        channels: n.channels,
      })),
      provider: "didlogic",
      configured: true,
      own_account: true,
    });
  }

  const ownCreds = await twilioCredsFor(ctx.orgId);
  return json({
    numbers: await numbers.list(ctx.orgId),
    provider: carrier?.provider ?? "twilio",
    configured: Boolean(ownCreds?.own),
    own_account: Boolean(ownCreds?.own),
  });
});

router.add("GET /numbers/available", async ({ req, query }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  const country = (query.get("country") ?? "US").toUpperCase().slice(0, 2);
  const creds = await twilioCredsFor(ctx.orgId);
  if (!creds?.own) throw new HttpError(409, "Connect your Twilio account first.", "NO_TWILIO_ACCOUNT");
  return json({
    numbers: await searchAvailable(country, query.get("contains") ?? undefined, creds),
  });
});

router.add("POST /numbers/purchase", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  requireAdmin(ctx);
  const body = await readJson<{ phone_number?: string; label?: string }>(req);
  if (!body.phone_number) throw new HttpError(400, "A phone number is required", "NUMBER_REQUIRED");
  const purchaseCreds = await twilioCredsFor(ctx.orgId);
  if (!purchaseCreds?.own) throw new HttpError(409, "Connect your Twilio account first.", "NO_TWILIO_ACCOUNT");
  const bought = await purchaseNumber(body.phone_number, purchaseCreds);
  const row = await numbers.add(ctx.orgId, {
    user_id: actor.uid,
    phone_number: bought.phone_number,
    label: body.label ?? null,
    provider_sid: bought.sid,
    is_verified: true,
  });
  return json({ number: row }, 201);
});

router.add("POST /numbers/bind", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  requireAdmin(ctx);
  const body = await readJson<{ phone_number?: string; label?: string }>(req);
  if (!body.phone_number) throw new HttpError(400, "A phone number is required", "NUMBER_REQUIRED");
  const bindCreds = await twilioCredsFor(ctx.orgId);
  if (!bindCreds?.own) throw new HttpError(409, "Connect your Twilio account first.", "NO_TWILIO_ACCOUNT");
  const started = await startCallerIdVerification(body.phone_number, ctx.orgId, bindCreds);
  await numbers.add(ctx.orgId, {
    user_id: actor.uid,
    phone_number: started.phone_number,
    label: body.label ?? null,
    is_verified: false,
  });
  // Twilio is already calling them; the code is what the robot asks for.
  return json({ validation_code: started.validation_code }, 201);
});

router.add("POST /numbers/:id/primary", async ({ req, params }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  requireAdmin(ctx);
  return json({ number: await numbers.setPrimary(ctx.orgId, requireInt(params.id, "number id")) });
});

router.add("DELETE /numbers/:id", async ({ req, params }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  requireAdmin(ctx);
  const row = await numbers.remove(ctx.orgId, requireInt(params.id, "number id"));
  // A purchased number goes back to Twilio; a bound caller ID just unlinks.
  const removeCreds = await twilioCredsFor(ctx.orgId);
  if (row.provider_sid && removeCreds?.own) {
    await releaseNumber(String(row.provider_sid), removeCreds);
  }
  return json({ removed: true });
});

// --- Email ---------------------------------------------------------------

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------


router.add("GET /recordings", async ({ req, query }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req, query);
  const rows = await recordings.list(ctx.orgId, {
    limit: Math.min(Number(query.limit ?? 50), 100),
    cursor: query.before_id ? Number(query.before_id) : undefined,
    callId: query.call_id ? Number(query.call_id) : undefined,
  });
  return json({ recordings: rows });
});

/**
 * A URL the player can stream from.
 *
 * Signed and short-lived rather than public: the bucket holds recorded
 * conversations, and a link that leaks should stop working on its own.
 */
router.add("GET /recordings/:id/url", async ({ req, params, query }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req, query);
  const row = await recordings.get(ctx.orgId, Number(params.id));
  if (row.status !== "stored" || !row.storage_path) {
    throw new HttpError(409, "That recording has no audio stored", "RECORDING_NOT_STORED");
  }
  const expiresIn = 3600;
  return json({
    url: await playbackUrl(row.storage_path as string, expiresIn),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  });
});

router.add("DELETE /recordings/:id", async ({ req, params, query }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req, query);
  requireAdmin(ctx);
  const row = await recordings.get(ctx.orgId, Number(params.id));
  // Audio first: a row without a blob is tidy, a blob without a row is
  // customer audio nothing can reach or delete.
  if (row.storage_path) await removeObject(row.storage_path as string);
  await recordings.remove(ctx.orgId, Number(params.id));
  return noContent();
});

router.add("GET /settings/recording", async ({ req, query }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req, query);
  const [row] = await sql`
    select record_calls, record_announcement
      from app_private.organizations where id = ${ctx.orgId}
  `;
  return json({
    enabled: Boolean(row?.record_calls),
    announce: Boolean(row?.record_announcement),
    configured: recordingConfigured(),
    usage: await recordings.usage(ctx.orgId),
  });
});

router.add("PUT /settings/recording", async ({ req, query }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req, query);
  requireAdmin(ctx);
  const body = await readJson<{ enabled?: boolean; announce?: boolean }>(req);

  const [row] = await sql`
    update app_private.organizations
       set record_calls = coalesce(${body.enabled ?? null}, record_calls),
           record_announcement = coalesce(${body.announce ?? null}, record_announcement),
           updated_at = now()
     where id = ${ctx.orgId}
    returning record_calls, record_announcement
  `;
  return json({ enabled: Boolean(row.record_calls), announce: Boolean(row.record_announcement) });
});

// ---------------------------------------------------------------------------
// SMS
//
// Threads live in the CRM's `conversations` table, shared with WhatsApp and
// email. This service only ever writes the SMS half of it.
// ---------------------------------------------------------------------------


router.add("GET /conversations", async ({ req, query }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req, query);
  return json({
    conversations: await conversations.list(ctx.orgId, {
      status: query.get("status") ?? undefined,
      cursor: int(query.get("before_id")),
      limit: parseLimit(query),
    }),
  });
});

router.add("POST /conversations", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  const body = await readJson<{ contact_id?: number; phone?: string }>(req);
  const conversation = body.contact_id
    ? await conversations.forContact(ctx.orgId, body.contact_id)
    // From the dialler: a number with no contact behind it yet.
    : body.phone
      ? await conversations.forPhone(ctx.orgId, body.phone)
      : await conversations.create(ctx.orgId, body);
  return json({ conversation }, 201);
});

router.add("GET /conversations/:id", async ({ req, params }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  return json({ conversation: await conversations.get(ctx.orgId, requireInt(params.id, "conversation id")) });
});

router.add("GET /conversations/:id/messages", async ({ req, params, query }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req, query);
  return json({
    messages: await conversations.messages(ctx.orgId, requireInt(params.id, "conversation id"), {
      cursor: int(query.get("before_id")),
      limit: parseLimit(query, 60),
    }),
  });
});

router.add("POST /conversations/:id/messages", async ({ req, params }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  const conversationId = requireInt(params.id, "conversation id");
  const body = await readJson<{ body?: string; attachments?: unknown }>(req);
  const message = await conversations.postMessage(ctx.orgId, conversationId, {
    body: body.body ?? "",
    sender_type: "user",
    sender_user_id: actor.uid,
    attachments: body.attachments,
  });
  // Everyone in the workspace sees the thread, so everyone gets the event.
  await broadcastToOrg(await orgs.memberIds(ctx.orgId), "chat:new_message", {
    conversation_id: conversationId,
    message,
  });
  return json({ message }, 201);
});

// Texting. Reuses the contact's conversation so SMS and in-app messages share
// one history rather than splitting into parallel threads.

router.add("POST /messages/sms", async ({ req }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  const body = await readJson<{ contact_id?: number; to?: string; body?: string; conversation_id?: number }>(req);
  const result = await conversations.sendSms(ctx.orgId, actor.uid, {
    contact_id: body.contact_id,
    to: body.to,
    body: body.body ?? "",
    conversation_id: body.conversation_id,
  });
  await broadcastToOrg(await orgs.memberIds(ctx.orgId), "chat:new_message", {
    conversation_id: result.conversation.id,
    message: result.message,
  });
  return json(result, 201);
});

// --- WhatsApp ------------------------------------------------------------
//
// The bridge pairs as a linked device, so connecting is a QR scan rather than
// an OAuth round trip. The instance name is derived here and never taken from
// the client: it is what maps an inbound webhook back to this workspace.

router.add("POST /conversations/:id/read", async ({ req, params }) => {
  const actor = await requireUser(req);
  const ctx = await requireOrg(actor, req);
  const result = await conversations.markRead(ctx.orgId, requireInt(params.id, "conversation id"));
  await broadcast(actor.uid, "messages:list_update", result);
  return json(result);
});

// --- Notes and tasks -----------------------------------------------------

Deno.serve(async (req) => {
  try {
    return await router.handle(req, "voip");
  } catch (error) {
    return toErrorResponse(error);
  }
});
