// Firebase is the identity provider. Clients send their Firebase ID token as a
// bearer token and these helpers verify it, plus stamp the one custom claim
// Supabase Realtime insists on.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { SignJWT, importPKCS8 } from "npm:jose@5.9.6";
import { env } from "./env.ts";

const PROJECT_ID = env("FIREBASE_PROJECT_ID");

if (!PROJECT_ID) {
  console.warn("FIREBASE_PROJECT_ID is not set — token verification will fail");
}

// Google publishes the signing keys for ID tokens here; jose caches and
// refreshes them on its own.
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export type FirebaseClaims = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  role?: string;
  [key: string]: unknown;
};

export async function verifyIdToken(token: string): Promise<FirebaseClaims> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
  });
  if (!payload.sub) throw new Error("Token has no subject");
  return payload as FirebaseClaims;
}

// --- Custom claims -------------------------------------------------------
//
// Supabase Realtime rejects any JWT without a `role` claim ("Fields `role` and
// `exp` are required in JWT"). Firebase does not put one there, so the server
// stamps role="authenticated" onto the account the first time it sees it.
// Firebase caches ID tokens for ~an hour, so a client that has just been
// stamped must call getIdToken(true) before it can join a Realtime channel.

const IDENTITY_SCOPE = "https://www.googleapis.com/auth/identitytoolkit";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const firebaseProjectId = () => PROJECT_ID;

const cachedAccessTokens = new Map<string, { value: string; expiresAt: number }>();

/** OAuth access token for the Firebase service account, per Google API scope. */
export async function getServiceAccountAccessToken(scope: string = IDENTITY_SCOPE): Promise<string> {
  const cached = cachedAccessTokens.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

  const raw = env("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
  const account = JSON.parse(raw) as { client_email: string; private_key: string };

  const key = await importPKCS8(account.private_key.replace(/\\n/g, "\n"), "RS256");
  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await response.text()}`);
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  cachedAccessTokens.set(scope, {
    value: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  });
  return body.access_token;
}

/** Permanently deletes the Firebase auth account. Used by account deletion. */
export async function deleteAuthUser(uid: string) {
  const accessToken = await getServiceAccountAccessToken();
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:delete`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ localId: uid }),
    },
  );
  if (!response.ok) {
    console.warn(`Failed to delete Firebase account ${uid}: ${await response.text()}`);
  }
}

/** No-ops when the account already carries the claim. */
export async function ensureAuthenticatedClaim(uid: string, claims: FirebaseClaims) {
  if (claims.role === "authenticated") return;

  try {
    const accessToken = await getServiceAccountAccessToken();
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          localId: uid,
          customAttributes: JSON.stringify({ role: "authenticated" }),
        }),
      },
    );
    if (!response.ok) {
      console.warn(`Failed to stamp role claim for ${uid}: ${await response.text()}`);
    }
  } catch (error) {
    // Never fail the request over this — the claim only gates Realtime, and
    // history still loads over HTTP without it.
    console.warn("ensureAuthenticatedClaim failed:", (error as Error).message);
  }
}
