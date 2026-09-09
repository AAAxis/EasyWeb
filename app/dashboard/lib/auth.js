"use client";

import { useEffect, useState } from "react";
import { FIREBASE_KEY, REFRESH_STORAGE } from "./config";
import { Button, C, Note, card, input } from "./ui";

// The same account as the phone app. Firebase over REST rather than the SDK:
// this is one sign-in form, and the SDK is 300KB to do what fetch does.
async function signInWithPassword(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
    },
  );
  const body = await res.json();
  if (!res.ok) {
    const code = body?.error?.message ?? "";
    throw new Error(
      /INVALID|PASSWORD|EMAIL/.test(code) ? "Wrong email or password." : "Sign-in failed — try again.",
    );
  }
  return body;
}

/**
 * The signed-in token, and how it survives a reload.
 *
 * An ID token lasts about an hour, so the refresh token is what makes coming
 * back tomorrow silent. `ready` is false until the restore has been attempted:
 * without it the sign-in form flashes on every load for someone already signed
 * in.
 */
export function useSession() {
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      let refresh = null;
      try { refresh = localStorage.getItem(REFRESH_STORAGE); } catch {}
      if (!refresh) { setReady(true); return; }
      try {
        const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh)}`,
        });
        const body = await res.json();
        if (res.ok && body.id_token) setToken(body.id_token);
        else try { localStorage.removeItem(REFRESH_STORAGE); } catch {}
      } catch {}
      setReady(true);
    })();
  }, []);

  const signIn = async (email, password) => {
    const body = await signInWithPassword(email, password);
    try { localStorage.setItem(REFRESH_STORAGE, body.refreshToken); } catch {}
    setToken(body.idToken);
  };

  const signOut = () => {
    try { localStorage.removeItem(REFRESH_STORAGE); } catch {}
    setToken(null);
  };

  return { token, ready, signIn, signOut };
}

export function SignIn({ onSignIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await onSignIn(email, password);
    } catch (e) {
      setError(e?.message ?? "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ width: "100%", maxWidth: 380, justifySelf: "center" }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>EasyCall</div>
      <div style={{ fontSize: 14, color: C.muted, margin: "6px 0 22px" }}>
        Your calls, texts and recordings.
      </div>
      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          style={input}
          type="email"
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          style={input}
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <Button onClick={submit} disabled={busy || !email.trim() || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <Note tone="bad">{error}</Note>
      </div>
    </div>
  );
}
