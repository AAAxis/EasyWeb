"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "../dashboard/lib/auth";
import { useVoip } from "../dashboard/lib/api";
import { C, Note, Skeleton } from "../dashboard/lib/ui";
import { Mark } from "./Chrome";
import Landing from "./Landing";

export const TABS = [
  // No Phone tab: the keypad is on the Dashboard, next to the numbers.
  ["/", "Dashboard"],
  ["/calls", "Calls"],
  ["/sms", "SMS"],
  ["/recordings", "Recordings"],
  // No Balance tab: the float is on Integrations, above what it pays for.
  ["/integrations", "Integrations"],
];

/**
 * The shell every dashboard route wears: the session, the bar, the tabs.
 *
 * Tabs are links rather than state, so each one has an address — reloading
 * Recordings lands on Recordings, and a link to the SMS tab is a link to the
 * SMS tab. They are `next/link` rather than bare anchors, so following one is
 * a render and not a fresh document: the session, and the frame around it,
 * stay exactly where they were.
 *
 * Narrow, they become a drawer. Six pills wrapped onto two rows took a third
 * of a phone screen before any of the app showed, and the second row read as
 * a different kind of thing from the first. Which breakpoint hides which is
 * left to CSS rather than to a width in state — the drawer cannot then be left
 * open across a resize, because above 720px it is not displayed at all.
 */
export default function Dashboard({ here, children }) {
  const { token, ready, signIn, signOut } = useSession();
  const [error, setError] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const api = useVoip(token);
  // Screens take these as props, so they have to keep their identity across
  // renders or every one of them re-fetches whenever anything else changes.
  const onError = useCallback((message) => setError(message), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // `/` doubles as the marketing page and is rendered on the server for people
  // arriving without an account, so it shows the landing until the session says
  // otherwise. The other tabs are not marketing pages: they hold this frame
  // while the session is restored, which is what stops arriving at one from
  // looking like being signed out.
  if (ready ? !token : here === "/") return <Landing onSignIn={signIn} />;

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 24px 72px" }}>
      <style>{`
        .ec-nav { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px; }
        .ec-burger {
          display: none; align-items: center; justify-content: center;
          width: 34px; height: 34px; padding: 0; flex-shrink: 0;
          border: 1px solid ${C.border}; background: #fff; color: ${C.text};
          border-radius: 10px; cursor: pointer;
        }
        .ec-scrim { position: fixed; inset: 0; background: rgba(11, 18, 32, 0.38); z-index: 40; }
        .ec-drawer {
          position: fixed; top: 0; right: 0; bottom: 0; z-index: 41;
          width: 258px; max-width: 82vw; overflow-y: auto;
          background: #fff; box-shadow: -10px 0 40px rgba(11, 18, 32, 0.18);
          padding: 16px 12px; display: flex; flex-direction: column; gap: 4px;
        }
        @media (max-width: 720px) {
          .ec-nav { display: none; }
          .ec-burger { display: inline-flex; }
          .ec-signout { display: none; }
        }
        /* Above the breakpoint the drawer is not displayed at all, so it cannot
           be left hanging open by a resize — no width in state to go stale. */
        @media (min-width: 721px) {
          .ec-scrim, .ec-drawer { display: none; }
        }
      `}</style>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Mark size={30} />
        <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>EasyCall</span>
        <span style={{ flex: 1 }} />
        {/* Signing out moves into the drawer on a phone rather than sitting
            beside the button that opens it — two controls in the same corner,
            one of them ending the session, is a thumb away from a mistake. */}
        <button
          className="ec-signout"
          onClick={signOut}
          style={{
            border: `1px solid ${C.border}`, background: "#fff", color: C.muted,
            borderRadius: 999, padding: "7px 15px", fontSize: 13, cursor: "pointer",
          }}
        >
          Sign out
        </button>
        {/* On the right, the side the drawer comes from. */}
        <button
          className="ec-burger"
          onClick={() => setMenuOpen(true)}
          aria-label="Open the menu"
          aria-expanded={menuOpen}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </header>

      <nav className="ec-nav">
        {TABS.map(([href, label]) => {
          const on = href === here;
          return (
            <Link
              key={href}
              href={href}
              prefetch
              style={{
                border: `1px solid ${on ? "#111317" : C.border}`,
                background: on ? "#111317" : "#fff",
                color: on ? "#fff" : C.text,
                borderRadius: 999, padding: "8px 16px", fontSize: 13.5, fontWeight: 500,
              }}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {menuOpen ? (
        <>
          {/* Tapping away closes it — on a phone that is the gesture people
              try first, ahead of finding the X. */}
          <div className="ec-scrim" onClick={() => setMenuOpen(false)} />
          <aside className="ec-drawer" aria-label="Sections">
            {TABS.map(([href, label]) => {
              const on = href === here;
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch
                  onClick={() => setMenuOpen(false)}
                  style={{
                    background: on ? "#111317" : "transparent",
                    color: on ? "#fff" : C.text,
                    borderRadius: 10, padding: "11px 13px", fontSize: 14.5, fontWeight: 500,
                  }}
                >
                  {label}
                </Link>
              );
            })}
            <span style={{ flex: 1 }} />
            <button
              onClick={() => { setMenuOpen(false); signOut(); }}
              style={{
                border: "none", borderTop: `1px solid ${C.border}`, background: "transparent",
                color: C.muted, textAlign: "left", cursor: "pointer",
                padding: "14px 13px 4px", marginTop: 8, fontSize: 14.5, fontWeight: 500,
              }}
            >
              Sign out
            </button>
          </aside>
        </>
      ) : null}

      <Note tone="bad">{error}</Note>
      {/* Set off from the navigation above it: the tabs are chrome, what is
          under them is the screen, and 12px read as one block of six pills and
          three tiles. */}
      <div style={{ marginTop: 26 }}>{token ? children({ api, onError }) : <Skeleton />}</div>
    </div>
  );
}
