// Twilio voice webhooks — /functions/v1/twilio/*
//
// Twilio posts form-encoded bodies here and expects TwiML back. These routes
// are unauthenticated by design (Twilio has no Firebase token); the signature
// header is what proves the request came from Twilio, and it is verified
// whenever TWILIO_AUTH_TOKEN is set.
import { corsHeaders } from "../_shared/http.ts";
import { env } from "../_shared/env.ts";
import { sql } from "../_shared/db.ts";
import { calls } from "../_shared/activity.ts";
import { contacts } from "../_shared/repository.ts";
import { archive } from "../_shared/providers/recordings.ts";
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
        const member = uid
          ? await sql`select org_id from app_private.org_members where user_id = ${uid} limit 1`
          : [];
        const orgId = member.length > 0 ? Number(member[0].org_id) : null;

        // Caller ID must be a number the account owns or has verified. The
        // workspace's own number (purchased or bound) wins; TWILIO_CALLER_ID
        // is the platform-wide fallback. params.From is the client identity,
        // which Twilio rejects as a caller id — so having neither is a
        // configuration error, not something to paper over with a blank value.
        const { numbers } = await import("../_shared/repository.ts");
        const from = (orgId ? await numbers.primaryFor(orgId) : null) ?? env("TWILIO_CALLER_ID");
        if (!from) {
          return xml("<Response><Say>Calling is not configured for this workspace.</Say></Response>");
        }

        const policy = await recordingPolicy(orgId);

        // The notice plays to the person being called, on their own leg, before
        // the two are bridged — so they hear it before anything is recorded.
        const announce = policy?.record && policy.announce
          ? ` url="${esc(publicUrl("announce"))}"`
          : "";

        return xml(
          `<Response><Dial callerId="${esc(from)}" answerOnBridge="true" ` +
            `action="${esc(publicUrl("status"))}" method="POST"${recordAttributes(policy)}>` +
            `<Number${announce}>${esc(to)}</Number></Dial></Response>`,
        );
      }

      // Played to the called party the moment they pick up, before the bridge.
      case "announce":
        return xml(
          "<Response><Say voice=\"alice\">This call may be recorded.</Say></Response>",
        );

      // Inbound: ring the registered client for whoever owns the number.
      case "incoming": {
        const to = params.To ?? "";
        const rows = await sql`
          select user_id, org_id from app_private.phone_numbers
           where phone_number = ${to} and user_id is not null
           limit 1
        `;
        if (rows.length === 0) {
          return xml("<Response><Say>This number is not in service.</Say></Response>");
        }

        const policy = await recordingPolicy(Number(rows[0].org_id));
        // Inbound, the caller is already on the line, so the notice goes ahead
        // of the dial rather than onto the far leg.
        const notice = policy?.record && policy.announce
          ? '<Say voice="alice">This call may be recorded.</Say>'
          : "";

        return xml(
          `<Response>${notice}<Dial timeout="30"${recordAttributes(policy)}>` +
            `<Client>${esc(String(rows[0].user_id))}</Client></Dial></Response>`,
        );
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
          select org_id from app_private.phone_numbers where phone_number = ${to} limit 1
        `;
        if (owner.length === 0) {
          console.warn(`Inbound SMS to an unknown number: ${to}`);
          return xml("<Response/>");
        }

        const { conversations } = await import("../_shared/activity.ts");
        await conversations.receiveSms(Number(owner[0].org_id), from, body, params.MessageSid ?? null);

        return xml("<Response/>");
      }

      // Twilio verified (or failed to verify) a caller ID the person is
      // binding as their own number. The org rides in the signed URL, same as
      // the recording callback.
      case "callerid": {
        const orgId = Number(url.searchParams.get("org") ?? 0);
        const phoneNumber = params.OutgoingCallerId ?? params.To ?? "";
        if (orgId && phoneNumber && params.VerificationStatus === "success") {
          const { numbers } = await import("../_shared/repository.ts");
          await numbers.markVerified(orgId, phoneNumber);
        }
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
        const sid = params.CallSid;
        const to = params.To ?? "";
        const from = params.From ?? "";
        const duration = Number(params.CallDuration ?? params.DialCallDuration ?? 0);
        const status = (params.CallStatus ?? params.DialCallStatus ?? "completed").toLowerCase();

        // Who this call belongs to.
        //
        // Matching To/From against our own numbers only ever worked for inbound
        // calls. A call the app places arrives here as From="client:<uid>" and
        // To=<whoever was dialled> — neither is a number we own, so this bailed
        // and logged nothing, and every outbound call stayed at the app's
        // optimistic row: in_progress, no duration, forever.
        const uid = from.startsWith("client:") ? from.slice("client:".length) : null;
        const owner = uid
          ? await sql`
              select org_id, user_id from app_private.org_members
               where user_id = ${uid} limit 1
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
          const shown = uid ? await numbers.primaryFor(orgId) : from;
          const direction = uid || !params.Direction?.startsWith("inbound") ? "outbound" : "inbound";
          const other = direction === "inbound" ? from : to;
          const match = await contacts.findByPhone(orgId, other);
          const settled = ["completed", "busy", "failed", "no-answer", "canceled"].includes(status)
            ? status.replace("-", "_")
            : "completed";
          const seconds = Number.isFinite(duration) ? duration : 0;

          // The app writes a row the moment it dials, so the call shows up
          // before it connects. This is that row growing up — the same call,
          // finished — rather than a second one beside it.
          const [reconciled] = await sql`
            update app_private.calls
               set status = ${settled},
                   duration_seconds = ${seconds},
                   ended_at = now(),
                   provider_call_sid = coalesce(provider_call_sid, ${sid}),
                   from_number = coalesce(from_number, ${shown}),
                   contact_id = coalesce(contact_id, ${match?.id ?? null})
             where id = (
               select id from app_private.calls
                where org_id = ${orgId}
                  and status = 'in_progress'
                  and to_number = ${to}
                  and started_at > now() - interval '6 hours'
                order by id desc limit 1
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
