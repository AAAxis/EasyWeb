// Live updates are broadcast to a private Supabase Realtime topic named
// user:<firebase-uid>. Clients subscribe to their own topic; the server pushes
// with the service role key over the REST broadcast endpoint, which avoids
// holding a socket open inside a short-lived function.
import { env } from "./env.ts";

const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

export async function broadcast(uid: string, event: string, payload: unknown) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;

  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ topic: `user:${uid}`, event, payload, private: true }],
      }),
    });
  } catch (error) {
    // Realtime carries live updates only — history always loads over HTTP, so
    // a failed broadcast degrades the app rather than breaking the request.
    console.warn(`broadcast ${event} to ${uid} failed:`, (error as Error).message);
  }
}

/** Fans an event out to every member of an org. */
export async function broadcastToOrg(uids: string[], event: string, payload: unknown) {
  await Promise.all(uids.map((uid) => broadcast(uid, event, payload)));
}
