"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Phone from "../dashboard/screens/Phone";
import { useSession } from "../dashboard/lib/auth";
import { useVoip } from "../dashboard/lib/api";
import { C, Note, Skeleton } from "../dashboard/lib/ui";
import { Mark } from "./Chrome";
import Landing from "./Landing";

/**
 * The shell every signed-in route wears.
 *
 * Two screens, and no tab bar: Activity is the app, and the profile control in
 * the header — which wears the balance, because that is the number worth a
 * glance — opens Settings over it. The logo comes back.
 *
 * The keypad belongs to the shell rather than to either screen. It is mounted
 * for the whole session and merely hidden when its dialog shuts, never
 * unmounted: the Twilio SDK registers on mount and drops that registration on
 * unmount, so a keypad that exists only while its dialog is open is a phone
 * nobody can ring. Hiding keeps it registered, and a call in progress survives
 * moving between screens because the shell outlives them.
 */
export default function Dashboard({ here, children }) {
  const { token, ready, signIn, signOut } = useSession();
  const [error, setError] = useState(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [accountBalance, setAccountBalance] = useState(null);
  const api = useVoip(token);
  // Screens take these as props, so they have to keep their identity across
  // renders or every one of them re-fetches whenever anything else changes.
  const onError = useCallback((message) => setError(message), []);

  useEffect(() => {
    if (!token) { setAccountBalance(null); return; }
    api("/balance")
      .then((body) => setAccountBalance(body.held?.[0] ?? null))
      .catch(() => setAccountBalance(null));
  }, [api, token]);

  const profileLabel = accountBalance
    ? `${Number(accountBalance.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${accountBalance.currency}`
    : "Balance";

  // `/` doubles as the marketing page and is rendered on the server for people
  // arriving without an account, so it shows the landing until the session says
  // otherwise. The other routes are not marketing pages: they hold this frame
  // while the session is restored, which is what stops arriving at one from
  // looking like being signed out.
  if (ready ? !token : here === "/") return <Landing onSignIn={signIn} />;

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 24px 72px" }}>
      <style>{`
        @media (max-width: 720px) {
          .ec-phone-shell {
            inset: 0 !important; width: 100% !important; height: 100dvh;
            max-width: none !important; max-height: none !important;
            transform: none !important; overflow-y: auto;
            background: #fff;
          }
          .ec-phone { max-width: none !important; min-height: 100%; }
          .ec-phone-card {
            min-height: 100dvh; border: none !important; border-radius: 0 !important;
            padding: max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom)) !important;
          }
        }
      `}</style>
      <header style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Link href="/calls" aria-label="Open Activity" style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
          <Mark size={30} />
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>EasyCall</span>
        </Link>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setProfileOpen((open) => !open)}
          aria-label={`Open profile menu. ${profileLabel}`}
          aria-expanded={profileOpen}
          style={{
            border: `1px solid ${C.border}`, background: "#fff", color: C.text,
            borderRadius: 999, padding: "4px 11px 4px 5px", fontSize: 12.5,
            display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, cursor: "pointer",
          }}
        >
          <span style={{
            width: 26, height: 26, borderRadius: "50%", background: C.text, color: "#fff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" />
            </svg>
          </span>
          {profileLabel}
        </button>
        {profileOpen ? (
          <>
            <button
              onClick={() => setProfileOpen(false)}
              aria-label="Close profile menu"
              style={{ position: "fixed", inset: 0, zIndex: 29, border: 0, background: "transparent" }}
            />
            <div
              role="menu"
              style={{
                position: "absolute", zIndex: 30, right: 0, top: 44, width: 190,
                padding: 6, border: `1px solid ${C.border}`, borderRadius: 12,
                background: "#fff", boxShadow: "0 14px 36px rgba(11,18,32,.16)",
              }}
            >
              {[["/calls", "Calls"], ["/sms", "SMS"], ["/integrations", "Settings"]].map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  role="menuitem"
                  onClick={() => setProfileOpen(false)}
                  style={{
                    display: "block", padding: "11px 12px", borderRadius: 8,
                    color: C.text, fontSize: 14, fontWeight: 500,
                    background: here === href ? "#F1F3F5" : "transparent",
                  }}
                >
                  {label}
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </header>

      <Note tone="bad">{error}</Note>
      {here === "/integrations" && token ? (
        <section
          aria-label="Settings"
          style={{
            position: "fixed", inset: 0, zIndex: 45, overflowY: "auto",
            background: C.bg,
            padding: "max(20px, env(safe-area-inset-top)) 24px max(32px, env(safe-area-inset-bottom))",
          }}
        >
          <div style={{ maxWidth: 1120, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 22 }}>
              <h1 style={{ margin: 0, fontSize: 22, color: C.text }}>Settings</h1>
              <span style={{ flex: 1 }} />
              <Link
                href="/calls"
                aria-label="Close settings"
                style={{
                  width: 38, height: 38, borderRadius: "50%", border: `1px solid ${C.border}`,
                  background: "#fff", color: C.text, display: "inline-flex",
                  alignItems: "center", justifyContent: "center", fontSize: 25, lineHeight: 1,
                }}
              >
                ×
              </Link>
            </div>
            {children({ api, onError, signOut })}
          </div>
        </section>
      ) : (
        <div style={{ marginTop: 26 }}>
          {token ? children({ api, onError, signOut }) : <Skeleton />}
        </div>
      )}

      {token ? (
        <>
          <button
            className="ec-call-fab"
            onClick={() => setPhoneOpen(true)}
            aria-label="Open dialer"
            title="Call"
            style={{
              position: "fixed", right: 24, bottom: 24, zIndex: 39,
              width: 58, height: 58, border: "none", borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "#111317", color: "#fff", cursor: "pointer",
              boxShadow: "0 10px 28px rgba(11, 18, 32, 0.28)",
            }}
          >
            <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
          {phoneOpen ? (
            <div
              onClick={() => setPhoneOpen(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(11,18,32,0.38)", zIndex: 50 }}
            />
          ) : null}
          {/* Hidden, not unmounted — see the note above. */}
          <div
            className="ec-phone-shell"
            style={phoneOpen
              ? {
                position: "fixed", zIndex: 51, top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                width: 360, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 48px)", overflowY: "auto",
              }
              : { display: "none" }}
          >
            <Phone api={api} onError={onError} onClose={() => setPhoneOpen(false)} />
          </div>
        </>
      ) : null}
    </div>
  );
}
