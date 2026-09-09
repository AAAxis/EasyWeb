"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
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
  ["/balance", "Balance"],
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
 */
export default function Dashboard({ here, children }) {
  const { token, ready, signIn, signOut } = useSession();
  const [error, setError] = useState(null);
  const api = useVoip(token);
  // Screens take these as props, so they have to keep their identity across
  // renders or every one of them re-fetches whenever anything else changes.
  const onError = useCallback((message) => setError(message), []);

  // `/` doubles as the marketing page and is rendered on the server for people
  // arriving without an account, so it shows the landing until the session says
  // otherwise. The other tabs are not marketing pages: they hold this frame
  // while the session is restored, which is what stops arriving at one from
  // looking like being signed out.
  if (ready ? !token : here === "/") return <Landing onSignIn={signIn} />;

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 24px 72px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Mark size={30} />
        <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>EasyCall</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={signOut}
          style={{
            border: `1px solid ${C.border}`, background: "#fff", color: C.muted,
            borderRadius: 999, padding: "7px 15px", fontSize: 13, cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </header>

      <nav style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
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

      <Note tone="bad">{error}</Note>
      <div style={{ marginTop: 12 }}>{token ? children({ api, onError }) : <Skeleton />}</div>
    </div>
  );
}
