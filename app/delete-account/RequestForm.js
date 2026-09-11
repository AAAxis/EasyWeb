"use client";

import { useState } from "react";

// The deletion request, for anyone without the app. It posts to the EasyDeck
// API — the backend the app's accounts live in — which files the request and
// emails the person a receipt, copied to us, so it is answered on one thread.
const ENDPOINT = "https://skembiloeumcibtdghzm.supabase.co/functions/v1/api/public/account-deletion";

const field = {
  width: "100%", boxSizing: "border-box", padding: "12px 14px", fontSize: 15,
  border: "1px solid var(--line)", borderRadius: 10, background: "#fff", color: "var(--ink)",
  outline: "none",
};
const label = { display: "block", fontSize: 13.5, fontWeight: 600, color: "var(--ink)", marginBottom: 6 };

export default function RequestForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  // Hidden from people, filled by bots; the server ignores any request with it.
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, website, app: "EasyCall" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = typeof body.error === "string" ? body.error : body.error?.message || body.message;
        throw new Error(message || "That didn't go through. Try again, or email support@chatkit.cc.");
      }
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div role="status" style={{ background: "#ECFDF3", border: "1px solid #ABEFC6", borderRadius: 12, padding: 18, color: "#085D3A", lineHeight: 1.6 }}>
        <b>Request received.</b> We&apos;ve emailed a confirmation to <b>{email}</b>. Your account
        and its data will be deleted within 30 days, and we&apos;ll reply to that email when it&apos;s done.
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
      <div>
        <label htmlFor="del-email" style={label}>Email you sign in with</label>
        <input id="del-email" type="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={field} />
      </div>
      <div>
        <label htmlFor="del-name" style={label}>Your name <span style={{ fontWeight: 400, color: "var(--faint)" }}>(optional)</span></label>
        <input id="del-name" type="text" autoComplete="name" value={name}
          onChange={(e) => setName(e.target.value)} placeholder="Full name" style={field} />
      </div>
      <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1} autoComplete="off" aria-hidden="true"
        style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />
      {error ? <p role="alert" style={{ margin: 0, color: "#B42318", fontSize: 14 }}>{error}</p> : null}
      <button type="submit" disabled={sending} style={{
        padding: "13px 18px", fontSize: 15, fontWeight: 600, color: "#fff", border: 0, borderRadius: 10,
        background: "var(--tint)", cursor: sending ? "default" : "pointer", opacity: sending ? 0.6 : 1,
      }}>
        {sending ? "Sending…" : "Request account deletion"}
      </button>
    </form>
  );
}
