"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { FIREBASE_KEY, REFRESH_STORAGE, TOKEN_STORAGE } from "./config";
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

const Session = createContext({ token: null, ready: false, signIn: async () => {}, signOut: () => {} });

/** Milliseconds left on an ID token; 0 if it cannot be read. */
function lifeLeft(jwt) {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp * 1000 - Date.now();
  } catch {
    return 0;
  }
}

const remember = (refreshToken, idToken) => {
  try {
    localStorage.setItem(REFRESH_STORAGE, refreshToken);
    localStorage.setItem(TOKEN_STORAGE, idToken);
  } catch {}
};

/**
 * The signed-in token, and how it survives both a reload and a tab change.
 *
 * It lives in the root layout, which the App Router keeps mounted across
 * navigations — so moving between tabs no longer throws the session away and
 * starts again from signed-out. That is what made every tab switch show the
 * marketing page for a moment.
 *
 * An ID token lasts about an hour, so the refresh token is what makes coming
 * back tomorrow silent. `ready` is false until the restore has been attempted:
 * without it the sign-in form flashes on every load for someone already signed
 * in. The last ID token is kept alongside it so a reload with time still on the
 * clock is signed in immediately, rather than after a round trip to Google.
 */
export function SessionProvider({ children }) {
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      let refresh = null;
      let cached = null;
      try {
        refresh = localStorage.getItem(REFRESH_STORAGE);
        cached = localStorage.getItem(TOKEN_STORAGE);
      } catch {}
      if (!refresh) { setReady(true); return; }

      // Comfortably inside its hour: use it as it stands. Minting a fresh one
      // anyway would change the token every screen's fetch is keyed on, and
      // every screen would load its data twice.
      if (cached && lifeLeft(cached) > 5 * 60_000) {
        setToken(cached);
        setReady(true);
        return;
      }

      try {
        const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh)}`,
        });
        const body = await res.json();
        if (res.ok && body.id_token) {
          setToken(body.id_token);
          remember(body.refresh_token ?? refresh, body.id_token);
        } else {
          try {
            localStorage.removeItem(REFRESH_STORAGE);
            localStorage.removeItem(TOKEN_STORAGE);
          } catch {}
        }
      } catch {}
      setReady(true);
    })();
  }, []);

  const signIn = async (email, password) => {
    const body = await signInWithPassword(email, password);
    remember(body.refreshToken, body.idToken);
    setToken(body.idToken);
  };

  const signOut = () => {
    try {
      localStorage.removeItem(REFRESH_STORAGE);
      localStorage.removeItem(TOKEN_STORAGE);
    } catch {}
    setToken(null);
  };

  return <Session.Provider value={{ token, ready, signIn, signOut }}>{children}</Session.Provider>;
}

export const useSession = () => useContext(Session);

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
    <div style={{ width: "100%", maxWidth: 420, justifySelf: "stretch" }}>
      <div
        style={{
          background: "#fff", border: `1px solid ${C.border}`, borderRadius: 20,
          padding: 28, boxShadow: "0 18px 50px rgba(11,18,32,0.08)",
          display: "flex", flexDirection: "column", gap: 10,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>Sign in</div>
        <div style={{ fontSize: 14, color: C.muted, marginBottom: 6 }}>
          The same account as the app.
        </div>
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
