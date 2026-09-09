/**
 * Call recordings: Twilio records the leg, we keep the audio.
 *
 * Twilio deletes recordings when an account is closed or a retention rule
 * fires, and reaching them needs account credentials — neither of which we want
 * playback to depend on. So the recording callback copies the MP3 once into a
 * private Supabase Storage bucket, and the app plays it through a short-lived
 * signed URL. Twilio's copy is deleted afterwards: it has served its purpose,
 * and leaving customer audio in two places doubles the exposure.
 */
import { env, has } from "../env.ts";
import { sql } from "../db.ts";

export const BUCKET = "call-recordings";

/** Recording needs the same account credentials calling does. */
export const recordingConfigured = () => has("TWILIO_ACCOUNT_SID") && has("TWILIO_AUTH_TOKEN");

const storageBase = () => `${env("SUPABASE_URL")}/storage/v1`;
const serviceKey = () => env("SUPABASE_SERVICE_ROLE_KEY");

const storageHeaders = () => ({
  Authorization: `Bearer ${serviceKey()}`,
  apikey: serviceKey(),
});

const twilioAuth = () =>
  `Basic ${btoa(`${env("TWILIO_ACCOUNT_SID")}:${env("TWILIO_AUTH_TOKEN")}`)}`;

/**
 * Copies one recording out of Twilio and into the bucket.
 *
 * Idempotent on the recording sid: Twilio retries callbacks, and a retry must
 * update the existing row rather than store the audio twice. Failure is
 * recorded on the row instead of thrown — the caller is a webhook, and a 500
 * would only make Twilio retry a fetch that is not going to start working.
 */
export async function archive(
  orgId: number,
  input: { recordingSid: string; callSid: string; recordingUrl: string; duration: number },
): Promise<void> {
  const path = `${orgId}/${input.recordingSid}.mp3`;

  const [row] = await sql`
    insert into app_private.call_recordings
      (org_id, recording_sid, provider_call_sid, duration_seconds, status)
    values (${orgId}, ${input.recordingSid}, ${input.callSid}, ${input.duration}, 'pending')
    on conflict (recording_sid) do update
       set duration_seconds = excluded.duration_seconds,
           provider_call_sid = excluded.provider_call_sid
    returning id, status
  `;
  if (row.status === "stored") return;

  try {
    // Twilio serves the audio at the callback URL plus a format suffix.
    const audio = await fetch(`${input.recordingUrl}.mp3`, {
      headers: { Authorization: twilioAuth() },
    });
    if (!audio.ok) throw new Error(`Twilio returned ${audio.status} for the recording`);
    const bytes = new Uint8Array(await audio.arrayBuffer());

    const upload = await fetch(`${storageBase()}/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { ...storageHeaders(), "Content-Type": "audio/mpeg", "x-upsert": "true" },
      body: bytes,
    });
    if (!upload.ok) throw new Error(`Storage returned ${upload.status}: ${await upload.text()}`);

    await sql`
      update app_private.call_recordings
         set status = 'stored', storage_path = ${path}, size_bytes = ${bytes.byteLength},
             stored_at = now(), error = null
       where id = ${row.id}
    `;

    // Our copy is safe, so Twilio's is redundant customer audio.
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env("TWILIO_ACCOUNT_SID")}/Recordings/${input.recordingSid}.json`,
      { method: "DELETE", headers: { Authorization: twilioAuth() } },
    ).catch((error) => console.warn("Could not delete the Twilio copy:", error));
  } catch (error) {
    console.error(`Archiving ${input.recordingSid} failed:`, error);
    await sql`
      update app_private.call_recordings
         set status = 'failed', error = ${String((error as Error)?.message ?? error)}
       where id = ${row.id}
    `;
  }
}

/**
 * A signed URL the app can hand straight to an audio player.
 *
 * Storage answers Range requests on these, which is what lets a player show a
 * duration and seek instead of buffering the whole file first.
 */
export async function playbackUrl(path: string, expiresIn = 3600): Promise<string> {
  const res = await fetch(`${storageBase()}/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { ...storageHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new Error(`Could not sign the recording: ${await res.text()}`);
  const body = (await res.json()) as { signedURL?: string };
  if (!body.signedURL) throw new Error("Storage returned no signed URL");
  // signedURL comes back relative to /storage/v1.
  return `${storageBase()}${body.signedURL.replace(/^\/storage\/v1/, "")}`;
}

/** Deletes the audio. The row is the caller's to remove. */
export async function removeObject(path: string): Promise<void> {
  const res = await fetch(`${storageBase()}/object/${BUCKET}/${path}`, {
    method: "DELETE",
    headers: storageHeaders(),
  });
  if (res.ok) return;

  // A missing object is the state we were asking for. Storage reports it as
  // HTTP 400 with a 404 in the body, so the status alone is not enough to tell
  // "already gone" from "could not delete" — and treating it as an error would
  // leave a row nobody can remove.
  const body = await res.text();
  if (res.status === 404 || body.includes("NoSuchKey") || body.includes("not_found")) return;

  throw new Error(`Could not delete the recording: ${body}`);
}
