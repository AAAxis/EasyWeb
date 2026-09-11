// Firebase Cloud Messaging (HTTP v1) — push to the mobile app's device tokens.
import { FCM_SCOPE, firebaseProjectId, getServiceAccountAccessToken } from "./firebase.ts";

export interface FcmResult { token: string; status: number; unregistered: boolean; }

/** Send one notification to one device token. */
export async function sendFcm(
  token: string,
  title: string,
  body: string,
  url = "/dashboard/hot",
  leadId?: number,
  // Whatever else the app needs to route the tap. FCM data values must be
  // strings, so they are sent as strings.
  extra: Record<string, string> = {},
): Promise<FcmResult> {
  const projectId = firebaseProjectId();
  const accessToken = await getServiceAccountAccessToken(FCM_SCOPE);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        // data rides alongside so the app can route the tap to the right screen
        data: { url, title, body, ...(leadId ? { leadId: String(leadId) } : {}), ...extra },
        android: { priority: "high", notification: { sound: "default" } },
        apns: { payload: { aps: { sound: "default", badge: 1 } } },
      },
    }),
  });
  let unregistered = false;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // A stale token: FCM returns 404 UNREGISTERED or 400 INVALID_ARGUMENT.
    unregistered = res.status === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT/i.test(text);
  } else {
    await res.arrayBuffer().catch(() => {});
  }
  return { token, status: res.status, unregistered };
}
