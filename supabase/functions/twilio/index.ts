// Twilio voice webhooks — /functions/v1/twilio/*
//
// Twilio posts form-encoded bodies here and expects TwiML back. These routes
// are unauthenticated by design (Twilio has no Firebase token); the signature
// header is what proves the request came from Twilio, and it is verified
// whenever TWILIO_AUTH_TOKEN is set.
import { corsHeaders } from "../_shared/http.ts";
import { env } from "../_shared/env.ts";
import { sql } from "../_shared/db.ts";
import { queueUsage } from "../_shared/usageBilling.ts";
import { calls } from "../_shared/activity.ts";
import { contacts } from "../_shared/repository.ts";
import { archive } from "../_shared/providers/recordings.ts";
import { classifySipCall, maskNumber, type SipRoutingConfig } from "../_shared/sipRouting.ts";
import { sipEndpoint, twilioAllowsCallerId, type SipEndpoint } from "../_shared/sipEndpoints.ts";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

/** Anything interpolated into TwiML has to survive being XML. */
const esc = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const xml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    headers: { ...corsHeaders, "Content-Type": "text/xml" },
  });

/**
 * The URL Twilio actually called.
 *
 * A function does NOT see its public URL: the platform hands it
 * `http://<ref>.supabase.co/twilio/voice`, while Twilio requested
 * `https://<ref>.supabase.co/functions/v1/twilio/voice` — different scheme and
 * a missing path prefix. Deriving anything public from `req.url` therefore
 * produces a URL that is wrong in two ways, which breaks signature
 * verification (Twilio signed the real URL) and any callback we hand back.
 */
const publicUrl = (route: string, search = "") => {
  const base = env("SUPABASE_URL");
  return `${base}/functions/v1/twilio/${route}${search}`;
};

/**
 * Twilio signs each request with the auth token over the full URL plus the
 * sorted POST body. A mismatch means the request did not come from Twilio.
 */
async function verifySignature(req: Request, url: string, params: Record<string, string>) {
  // Webhooks are signed with the auth token of the account that sent them —
  // which, with bring-your-own Twilio, may be a workspace's account rather
  // than the platform's. AccountSid in the payload says whose.
  let authToken = env("TWILIO_AUTH_TOKEN");
  const senderSid = params.AccountSid ?? "";
  if (senderSid && senderSid !== env("TWILIO_ACCOUNT_SID")) {
    const { rowByAccountSid } = await import("../_shared/providers/twilioAccount.ts");
    const own = await rowByAccountSid(senderSid);
    if (own && own.via_connect) {
      // Connect never reveals their auth token, so the signature can't be
      // checked — a known, authorized AccountSid is the trust anchor instead.
      return true;
    }
    if (own) authToken = String(own.auth_token);
  }
  if (!authToken) {
    console.warn("TWILIO_AUTH_TOKEN not set — skipping signature check");
    return true;
  }
  const signature = req.headers.get("X-Twilio-Signature");
  if (!signature) return false;

  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return encodeBase64(new Uint8Array(mac)) === signature;
}

/**
 * The number that was actually dialled.
 *
 * A call over the PSTN arrives with To="+6531072402". The same call arriving
 * over a SIP trunk arrives as To="sip:6531072402@easycall-voip.sip.twilio.com"
 * — a URI, with no plus. Matching that against `phone_numbers` found nothing,
 * so every call a carrier trunk delivered was answered with "this number is
 * not in service" and hung up three seconds later.
 */
const dialledNumber = (raw: string): string => {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const user = value.startsWith("sip:") || value.startsWith("sips:")
    ? value.slice(value.indexOf(":") + 1).split("@")[0]
    : value;
  const digits = user.replace(/[^\d+]/g, "");
  if (!digits) return "";
  return digits.startsWith("+") ? digits : `+${digits}`;
};

type RecordingPolicy = { orgId: number; record: boolean; announce: boolean };

/**
 * Whether this org records, and whether the other party is told.
 *
 * Recording is a per-workspace setting rather than a deploy-wide one, because
 * whether it is lawful depends on where the parties are, not on how the server
 * is configured.
 */
async function recordingPolicy(orgId: number | null): Promise<RecordingPolicy | null> {
  if (!orgId) return null;
  const rows = await sql`
    select id, record_calls, record_announcement
      from app_private.organizations where id = ${orgId} limit 1
  `;
  if (rows.length === 0) return null;
  return {
    orgId,
    record: Boolean(rows[0].record_calls),
    announce: Boolean(rows[0].record_announcement),
  };
}

/**
 * The attributes that turn a <Dial> into a recorded one.
 *
 * Dual-channel keeps each party on its own track, which is what makes a
 * recording worth reviewing. The org travels in the callback URL because the
 * recording callback arrives with nothing else that identifies the workspace —
 * and it is inside the URL Twilio signs, so it cannot be tampered with.
 */
const recordAttributes = (policy: RecordingPolicy | null) =>
  policy?.record
    ? ` record="record-from-answer-dual"` +
      ` recordingStatusCallback="${esc(publicUrl("recording", `?org=${policy.orgId}`))}"` +
      ` recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST"`
    : "";

/**
 * Bridge a paid, authorized outbound call to the PSTN number `to`.
 *
 * Shared by calls the app places and calls a registered softphone places, so
 * both get the same caller id, time limit, recording and callbacks.
 */
async function bridgeOut(callSid: string, orgId: number, from: string, to: string, seconds: number, owner?: string) {
  const policy = await recordingPolicy(orgId);
  // An unbilled call has no payment row for the status callback to read who
  // placed it and where it went, so those ride in the signed query instead.
  const query = `?call=${callSid}&org=${orgId}` + (owner
    ? `&user=${encodeURIComponent(owner)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    : "");

  // The notice plays to the person being called, on their own leg, before
  // the two are bridged — so they hear it before anything is recorded.
  const announce = policy?.record && policy.announce
    ? ` url="${esc(publicUrl("announce"))}"`
    : "";

  // The far leg reports its own outcome.
  //
  // `action` alone was not enough: Twilio requests it when the <Dial>
  // finishes, and a caller who gives up before anyone picks up does not
  // finish a dial — the call simply ends and no request is ever made. So
  // the row stayed in_progress, with no duration and no caller id, for
  // every call that was not answered. This callback always arrives once
  // the other leg exists. The parent's sid rides in the query string —
  // part of what Twilio signs — so both callbacks name the same call and
  // the second to land updates the row instead of logging it twice.
  const report =
    ` statusCallback="${esc(publicUrl("status", query))}"` +
    ` statusCallbackEvent="completed" statusCallbackMethod="POST"`;

  return xml(
    `<Response><Dial callerId="${esc(from)}" answerOnBridge="true" ` +
      `timeLimit="${seconds}" timeout="30" action="${esc(publicUrl("status", query))}" method="POST"${recordAttributes(policy)}>` +
      `<Number${announce}${report}>${esc(to)}</Number></Dial></Response>`,
  );
}

const sipConfig = (): SipRoutingConfig => ({
  domain: env("TWILIO_SIP_DOMAIN", "easycall-voip.sip.twilio.com"),
  domainSid: env("TWILIO_SIP_DOMAIN_SID") || undefined,
  carrierIps: env("SIP_CARRIER_IPS").split(",").map((ip) => ip.trim()).filter(Boolean),
});

/** One line per routing decision. Numbers are masked; no credentials exist in these params. */
const logRoute = (callSid: string, decision: string, fields: Record<string, unknown> = {}) =>
  console.info(JSON.stringify({ event: "voice_route", callSid, decision, ...fields }));

/**
 * A call a registered softphone placed through our SIP domain, to the PSTN.
 *
 * Twilio has already checked the SIP credentials; the endpoint row is what
 * lets that username call as a user, and the caller id is re-checked against
 * Twilio because the carrier drops a call with a caller id it will not carry.
 *
 * Softphone calls are not charged to the app wallet: the operator pays the
 * carrier directly. They are capped at SIP_MAX_CALL_SECONDS instead.
 */
async function sipOutbound(params: Record<string, string>, endpoint: SipEndpoint, destination: string | null) {
  const sid = params.CallSid ?? "";
  if (!destination) {
    logRoute(sid, "sip_outbound_rejected", { reason: "INVALID_DESTINATION" });
    return xml("<Response><Say>Dial the full international number, starting with plus and the country code.</Say><Hangup/></Response>");
  }

  let allowed: boolean;
  try {
    allowed = await twilioAllowsCallerId(endpoint.orgId, endpoint.callerId);
  } catch (error) {
    logRoute(sid, "sip_outbound_rejected", { reason: "CALLER_ID_CHECK_FAILED", error: (error as Error).message });
    return xml("<Response><Say>Calling is temporarily unavailable.</Say><Hangup/></Response>");
  }
  if (!allowed) {
    logRoute(sid, "sip_outbound_rejected", { reason: "CALLER_ID_NOT_VERIFIED", callerId: maskNumber(endpoint.callerId) });
    return xml("<Response><Say>Your caller number is not verified for outgoing calls.</Say><Hangup/></Response>");
  }

  const seconds = Number(env("SIP_MAX_CALL_SECONDS", "14400")) || 14400;
  logRoute(sid, "sip_outbound", { to: maskNumber(destination), callerId: maskNumber(endpoint.callerId), seconds });
  return await bridgeOut(sid, endpoint.orgId, endpoint.callerId, destination, seconds, endpoint.userId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const route = url.pathname.split("/").filter(Boolean).slice(1).join("/");

  const form = await req.formData().catch(() => new FormData());
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  // Verified against the URL Twilio signed, not the one we were handed.
  if (!(await verifySignature(req, publicUrl(route, url.search), params))) {
    return new Response("Invalid signature", { status: 403, headers: corsHeaders });
  }

  try {
    switch (route) {
      // Outbound: the app dials, Twilio asks what to do, we bridge to the
      // number the client passed as a custom parameter.
      case "voice": {
        const to = params.To ?? params.to ?? "";
        if (!to) return xml("<Response><Say>No destination number was provided.</Say></Response>");

        // The dialling client identifies the workspace: app-originated calls
        // arrive as "client:<firebase-uid>".
        const uid = params.From?.startsWith("client:") ? params.From.slice("client:".length) : null;
        const requestedOrg = /^\d+$/.test(params.OrgId ?? "") ? Number(params.OrgId) : null;
        const owned = uid ? await sql`
          select pn.org_id, pn.phone_number
            from app_private.phone_numbers pn
            join app_private.org_members m on m.org_id = pn.org_id and m.user_id = pn.user_id
           where pn.user_id = ${uid} and pn.is_verified = true
             and (${requestedOrg}::bigint is null or pn.org_id = ${requestedOrg})
           order by pn.is_primary desc, pn.id desc limit 1
        ` : [];
        const orgId = owned.length ? Number(owned[0].org_id) : null;
        const from = owned.length ? String(owned[0].phone_number) : null;
        // Never expose another customer's number or the platform fallback.
        if (!from) {
          return xml("<Response><Say>No verified phone number is assigned to your account.</Say><Hangup/></Response>");
        }

        const { authorizePrepaidCall } = await import("../_shared/prepaidCalls.ts");
        let payment;
        try {
          payment = await authorizePrepaidCall({sid:params.CallSid??'',accountSid:params.AccountSid??'',
            orgId:orgId!,userId:uid!,from,to,direction:'outbound'});
        } catch (error) {
          console.warn('Call payment rejected:', (error as any)?.code ?? (error as any)?.message);
          return xml('<Response><Hangup/></Response>');
        }

        return await bridgeOut(params.CallSid ?? "", orgId!, from, to, payment.seconds);
      }

      // Played to the called party the moment they pick up, before the bridge.
      case "announce":
        return xml(
          "<Response><Say voice=\"alice\">This call may be recorded.</Say></Response>",
        );

      // Inbound: ring the registered client for whoever owns the number.
      //
      // Everything that reaches the SIP domain lands here too, including calls
      // a softphone places OUT: Twilio labels both "inbound". Handling an
      // outgoing Zoiper call as inbound looked the far number up as one of
      // ours; the user's own verified mobile matched, the call was billed as
      // an inbound call from a caller with no number, and that was rejected.
      case "incoming": {
        const config = sipConfig();
        const sip = classifySipCall(params, config);
        if (sip.kind === "reject") {
          logRoute(params.CallSid ?? "", "sip_rejected", { reason: sip.reason });
          return xml('<Response><Reject reason="rejected"/></Response>');
        }
        let unknownSipUser = false;
        if (sip.kind === "endpoint") {
          const endpoint = await sipEndpoint(config.domain, sip.username);
          if (endpoint) return await sipOutbound(params, endpoint, sip.destination);
          // Not one of our softphones. The only other thing on the domain is a
          // carrier delivering a call — which must be to one of our numbers.
          unknownSipUser = true;
        }

        const to = dialledNumber(params.To ?? "");
        // The number belongs to the signed-in account behind its assigned
        // email. Workspace membership does not make every member a recipient.
        const rows = await sql`
          select pn.user_id, pn.org_id
            from app_private.phone_numbers pn
           where pn.phone_number = ${to} and pn.user_id is not null
           limit 1
        `;
        if (rows.length === 0) {
          if (unknownSipUser) {
            logRoute(params.CallSid ?? "", "sip_rejected", { reason: "UNKNOWN_SIP_USER" });
            return xml('<Response><Reject reason="rejected"/></Response>');
          }
          logRoute(params.CallSid ?? "", "inbound_unknown_number", { to: maskNumber(to) });
          return xml("<Response><Say>This number is not in service.</Say></Response>");
        }

        const { authorizePrepaidCall } = await import("../_shared/prepaidCalls.ts");
        let payment;
        try {
          payment = await authorizePrepaidCall({sid:params.CallSid??'',accountSid:params.AccountSid??'',
            orgId:Number(rows[0].org_id),userId:String(rows[0].user_id),from:dialledNumber(params.From??''),to,direction:'inbound'});
        } catch(error) {
          logRoute(params.CallSid ?? "", "inbound_rejected", { kind: sip.kind, reason: (error as any)?.code ?? (error as any)?.message });
          return xml('<Response><Reject reason="rejected"/></Response>');
        }
        logRoute(params.CallSid ?? "", "inbound", { kind: sip.kind, to: maskNumber(to), seconds: payment.seconds });

        const policy = await recordingPolicy(Number(rows[0].org_id));
        // Inbound, the caller is already on the line, so the notice goes ahead
        // of the dial rather than onto the far leg.
        const notice = policy?.record && policy.announce
          ? '<Say voice="alice">This call may be recorded.</Say>'
          : "";

        const clients = [...new Set(rows.map((r) => String(r.user_id)))]
          .map((uid) => `<Client>${esc(uid)}</Client>`)
          .join("");

        // Who is calling, as a number. Twilio hands the client leg whatever
        // arrived as From, and a call off a carrier's SIP trunk arrives as
        // "sip:6531061544@46.19.214.14" — which is what the incoming-call
        // screen then showed. Forwarding the caller as callerId is the ordinary
        // way to ring an agent: the number is the user part of the URI with its
        // plus put back. An anonymous caller has none, so the attribute is left
        // off rather than blanked. (Briefly suspected of stopping iOS ringing;
        // it did not — Twilio dialled every client with it set. That was push.)
        const caller = dialledNumber(params.From ?? "");
        const callerId = caller ? ` callerId="${esc(caller)}"` : "";

        return xml(
          `<Response>${notice}<Dial timeout="30" timeLimit="${payment.seconds}" action="${esc(publicUrl("status", `?call=${params.CallSid}&org=${rows[0].org_id}`))}" method="POST"${callerId}${recordAttributes(policy)}>` +
            `${clients}</Dial></Response>`,
        );
      }

      // The URL, including its account owner, is covered by Twilio's signature.
      case "sms-status": {
        const orgId = Number(url.searchParams.get("org"));
        const uid = url.searchParams.get("uid") ?? "";
        if (!Number.isSafeInteger(orgId) || orgId <= 0 || !uid) return new Response("Invalid usage owner", {status:400});
        const payment = url.searchParams.get("payment");
        if (payment) {
          const { recordSmsPaymentCallback } = await import("../_shared/prepaidSms.ts");
          await recordSmsPaymentCallback(payment,uid,orgId,params.MessageSid ?? "");
        }
        await queueUsage("sms", params.MessageSid ?? "", params.AccountSid ?? "", orgId, uid);
        return xml("<Response/>");
      }

      // Inbound text. Twilio expects TwiML back; an empty Response means
      // "received, no auto-reply".
      case "sms": {
        const from = params.From ?? "";
        const body = params.Body ?? "";
        const to = params.To ?? "";
        if (!from || !body) return xml("<Response/>");

        // The number texted identifies the workspace, the same way it does for
        // an inbound call.
        const owner = await sql`
          select org_id, user_id from app_private.phone_numbers where phone_number = ${to} limit 1
        `;
        if (owner.length === 0) {
          console.warn(`Inbound SMS to an unknown number: ${to}`);
          return xml("<Response/>");
        }

        const orgId = Number(owner[0].org_id);
        if (owner[0].user_id && params.MessageSid) {
          await queueUsage("sms", params.MessageSid, params.AccountSid ?? "", orgId, String(owner[0].user_id));
        }
        const { conversations } = await import("../_shared/activity.ts");
        const message = await conversations.receiveSms(orgId, from, body, params.MessageSid ?? null);

        // Tell the phones. Recording a text is not the same as anyone knowing
        // it came: this used to write the row and stop, so a text arrived in
        // silence and waited for someone to open the app. Every active device
        // of the workspace's members is sent it; a token FCM calls gone is
        // retired. Awaited but fenced — a push that fails must never turn into
        // a webhook that fails, or Twilio retries and the text lands twice.
        try {
          const sender = dialledNumber(from) || from;
          const known = await contacts.findByPhone(orgId, sender).catch(() => null);
          const title = String(known?.full_name || sender);
          const preview = body.length > 140 ? `${body.slice(0, 140)}…` : body;
          const tokens = await sql`
            select distinct dt.token
              from app_private.device_tokens dt
              join app_private.org_members m on m.user_id = dt.user_id
             where m.org_id = ${orgId} and dt.is_active = true
          ` as unknown as { token: string }[];
          if (tokens.length > 0) {
            const { sendFcm } = await import("../_shared/fcm.ts");
            const data = { conversationId: String(message.conversation_id), kind: "sms" };
            const dead: string[] = [];
            await Promise.all(tokens.map(async ({ token }) => {
              const result = await sendFcm(token, title, preview, "/sms", undefined, data).catch(() => null);
              if (result?.unregistered) dead.push(token);
            }));
            if (dead.length) {
              await sql`update app_private.device_tokens set is_active = false where token = any(${dead})`;
            }
          }
        } catch (pushError) {
          console.warn("SMS push failed:", (pushError as Error).message);
        }

        return xml("<Response/>");
      }

      // Twilio verified (or failed to verify) a caller ID the person is
      // binding as their own number. The org rides in the signed URL, same as
      // the recording callback.
      case "callerid-proof": {
        const { confirmPersonalNumberProof } = await import("../_shared/callerIdVerification.ts");
        await confirmPersonalNumberProof({orgId:Number(url.searchParams.get("org")??0),
          uid:url.searchParams.get("user")??'',key:url.searchParams.get("key")??'',
          accountSid:params.AccountSid??'',phone:params.To??'',digits:params.Digits??''});
        return xml("<Response><Hangup/></Response>");
      }
      case "callerid": {
        const { confirmPersonalNumber } = await import("../_shared/callerIdVerification.ts");
        await confirmPersonalNumber({orgId:Number(url.searchParams.get("org")??0),
          uid:url.searchParams.get("user")??'',key:url.searchParams.get("key")??'',
          accountSid:params.AccountSid??'',phone:params.OutgoingCallerId??params.To??'',status:params.VerificationStatus??''});
        return xml("<Response/>");
      }

      // Twilio finished writing a recording. The org rides in the query string,
      // which is part of what Twilio signed.
      case "recording": {
        const status = params.RecordingStatus ?? "completed";
        const sid = params.RecordingSid ?? "";
        const source = params.RecordingUrl ?? "";
        const orgId = Number(url.searchParams.get("org") ?? 0);

        if (status !== "completed" || !sid || !source || !orgId) return xml("<Response/>");

        await archive(orgId, {
          recordingSid: sid,
          callSid: params.CallSid ?? "",
          recordingUrl: source,
          duration: Number(params.RecordingDuration ?? 0) || 0,
        });

        return xml("<Response/>");
      }

      // Status callback: log the finished call against the org and, when we can
      // match the number, against the contact.
      case "status": {
        // Two callbacks land here: the <Dial> action, which describes the dial
        // from the parent call's side, and the far leg's own status callback.
        // Both settle on the parent sid — the action callback carries it as
        // CallSid, the leg carries it in the signed query — so the row is the
        // same row either way.
        const sid = url.searchParams.get("call") || params.CallSid;
        const orgInUrl = Number(url.searchParams.get("org") ?? 0) || null;
        const from = params.From ?? "";
        // Dial* describes the leg that was dialled; on the action callback the
        // bare CallStatus is the parent's own state — "in-progress", which is
        // not an outcome — so the dial's view wins where it exists.
        const duration = Number(params.DialCallDuration ?? params.CallDuration ?? 0);
        const status = (params.DialCallStatus ?? params.CallStatus ?? "completed").toLowerCase();

        const { recordPrepaidCallStatus } = await import("../_shared/prepaidCalls.ts");
        await recordPrepaidCallStatus(sid, params.AccountSid??'', params.DialCallSid ?? params.CallSid ?? '');
        const billedOwner = await sql`select org_id,user_id,from_number,to_number,direction from app_private.call_payments
          where provider_sid=${sid} and provider_account_sid=${params.AccountSid??''}`;
        // A softphone's parent leg reports To as a SIP URI; the billed row holds
        // the E.164 number it was bridged to.
        // An unbilled softphone call names its number, caller id and user in the
        // signed query for the same reason.
        const unbilled = billedOwner.length ? null : url.searchParams.get("user")
          ? { user: url.searchParams.get("user")!, from: url.searchParams.get("from") ?? "", to: url.searchParams.get("to") ?? "" }
          : null;
        const to = billedOwner[0]?.direction === "outbound" ? String(billedOwner[0].to_number) : unbilled?.to || (params.To ?? "");

        // Who this call belongs to.
        //
        // Matching To/From against our own numbers only ever worked for inbound
        // calls. A call the app places arrives here as From="client:<uid>" and
        // To=<whoever was dialled> — neither is a number we own, so this bailed
        // and logged nothing, and every outbound call stayed at the app's
        // optimistic row: in_progress, no duration, forever.
        const uid = from.startsWith("client:") ? from.slice("client:".length) : null;
        const owner = billedOwner.length ? billedOwner : unbilled && orgInUrl
          ? [{ org_id: orgInUrl, user_id: unbilled.user }]
          : uid
          ? await sql`
              select org_id, user_id from app_private.org_members
               where user_id = ${uid} limit 1
            `
          // The far leg's callback names the workspace in the signed URL, which
          // holds even when the caller id was the platform's number rather than
          // one of the workspace's own.
          : orgInUrl
          ? await sql`
              select org_id, user_id from app_private.phone_numbers
               where org_id = ${orgInUrl} order by is_primary desc, id limit 1
            `
          : await sql`
              select pn.org_id, pn.user_id from app_private.phone_numbers pn
               where pn.phone_number in (${to}, ${from})
               limit 1
            `;

        if (owner.length > 0) {
          const orgId = Number(owner[0].org_id);
          // What the other end saw. For a call the app placed, From is
          // "client:<uid>" — the caller id Twilio actually dialled with is the
          // workspace's own number, chosen by the voice handler, so that is
          // what belongs in the row. Without this the From column is empty for
          // every outbound call.
          const { numbers } = await import("../_shared/repository.ts");
          const shown = billedOwner[0]?.from_number ?? unbilled?.from ?? (uid ? await numbers.purchasedForUser(orgId, uid) : from);
          const direction = billedOwner[0]?.direction ?? (unbilled || uid || !params.Direction?.startsWith("inbound") ? "outbound" : "inbound");
          const other = direction === "inbound" ? from : to;
          const match = await contacts.findByPhone(orgId, other);
          const settled = ["completed", "busy", "failed", "no-answer", "canceled"].includes(status)
            ? status.replace("-", "_")
            : "completed";
          const seconds = Number.isFinite(duration) ? duration : 0;

          // The app writes a row the moment it dials, so the call shows up
          // before it connects. This is that row growing up — the same call,
          // finished — rather than a second one beside it. Keyed on the sid
          // first: once a row carries it, a repeat callback (or the second of
          // the two) refines that row instead of logging the call twice.
          const [reconciled] = await sql`
            update app_private.calls
               set status = ${settled},
                   duration_seconds = ${seconds},
                   ended_at = now(),
                   provider_call_sid = ${sid},
                   from_number = coalesce(from_number, ${shown}),
                   contact_id = coalesce(contact_id, ${match?.id ?? null})
             where id = (
               select id from app_private.calls
                where org_id = ${orgId}
                  and (
                    provider_call_sid = ${sid}
                    or (provider_call_sid is null
                        and status = 'in_progress'
                        and to_number = ${to}
                        and started_at > now() - interval '6 hours')
                  )
                order by (provider_call_sid = ${sid}) desc nulls last, id desc
                limit 1
             )
            returning id`;

          // Nothing to grow up: an inbound call, or one placed from somewhere
          // that never announced itself.
          if (!reconciled) {
            await calls.log(orgId, owner[0].user_id as string, {
              direction,
              from_number: shown ?? from,
              to_number: to,
              status: settled,
              duration_seconds: seconds,
              provider_call_sid: sid,
              contact_id: match?.id ?? null,
              ended_at: new Date(),
            }).catch((error) => {
              // A duplicate sid means Twilio retried a callback we already stored.
              if (!String(error?.message ?? "").includes("calls_provider_sid_idx")) throw error;
            });
          }
        }

        return xml("<Response/>");
      }

      default:
        return new Response("Not found", { status: 404, headers: corsHeaders });
    }
  } catch (error) {
    console.error(`twilio/${route} failed:`, error);
    return xml("<Response><Say>An application error occurred.</Say></Response>");
  }
});
