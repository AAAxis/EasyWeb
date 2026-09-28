import { sql } from './db.ts';
import { credsFor, type TwilioCreds } from './providers/twilioAccount.ts';

export type SipEndpoint = { orgId: number; userId: string; callerId: string };

// The endpoint row authorizes the username; the caller id must also still be
// a number that user holds in the workspace, so unassigning a number stops it
// being presented without anyone remembering to edit the endpoint.
export async function sipEndpoint(domain: string, username: string): Promise<SipEndpoint | null> {
  const [row] = await sql`select e.org_id, e.user_id, e.caller_id
      from app_private.sip_endpoints e
      join app_private.org_members m on m.org_id = e.org_id and m.user_id = e.user_id
      join app_private.phone_numbers pn on pn.org_id = e.org_id and pn.user_id = e.user_id and pn.phone_number = e.caller_id
     where e.sip_domain = ${domain.toLowerCase()} and e.username = ${username} and e.is_active = true
     limit 1`;
  return row ? { orgId: Number(row.org_id), userId: String(row.user_id), callerId: String(row.caller_id) } : null;
}

/**
 * Whether Twilio will accept `number` as the caller id on a PSTN <Dial>.
 *
 * Twilio allows only numbers the account owns or has verified as outgoing
 * caller ids. Owning a number at DIDWW makes it neither, and an unauthorized
 * caller id fails the call at Twilio (error 21210/13214) after we have already
 * charged for it — so this is asked of Twilio itself, per call, not assumed.
 */
export async function twilioAllowsCallerId(orgId: number, number: string): Promise<boolean> {
  const creds: TwilioCreds | null = await credsFor(orgId);
  if (!creds) return false;
  const headers = { Authorization: creds.bearer ? `Bearer ${creds.bearer}` : `Basic ${btoa(`${creds.authUser ?? creds.accountSid}:${creds.authToken}`)}` };
  const base = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}`;
  const has = async (path: string, key: string) => {
    const response = await fetch(`${base}/${path}?PhoneNumber=${encodeURIComponent(number)}`, { headers, signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`TWILIO_${response.status}`);
    const body = await response.json();
    return (body[key] ?? []).some((n: { phone_number: string }) => n.phone_number === number);
  };
  const [verified, owned] = await Promise.all([
    has('OutgoingCallerIds.json', 'outgoing_caller_ids'),
    has('IncomingPhoneNumbers.json', 'incoming_phone_numbers'),
  ]);
  return verified || owned;
}
