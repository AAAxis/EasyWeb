"use client";

import { useCallback, useState } from "react";
import { SignIn, useSession } from "../dashboard/lib/auth";
import { useVoip } from "../dashboard/lib/api";
import { C, Note } from "../dashboard/lib/ui";
import { Mark } from "./Chrome";
import Landing from "./Landing";

export const TABS = [
  ["/", "Dashboard"],
  ["/calls", "Calls"],
  ["/sms", "SMS"],
  ["/recordings", "Recordings"],
  ["/integrations", "Integrations"],
];

/**
 * The shell every dashboard route wears: the session, the bar, the tabs.
 *
 * Tabs are links rather than state, so each one has an address — reloading
 * Recordings lands on Recordings, and a link to the SMS tab is a link to the
 * SMS tab.
 */
export default function Dashboard({ here, children }) {
  const { token, ready, signIn, signOut } = useSession();
  const [error, setError] = useState(null);
  const api = useVoip(token);
  // Screens take these as props, so they have to keep their identity across
  // renders or every one of them re-fetches whenever anything else changes.
  const onError = useCallback((message) => setError(message), []);

  if (!ready || !token) return <Landing onSignIn={signIn} />;

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
            <a
              key={href}
              href={href}
              style={{
                border: `1px solid ${on ? "#111317" : C.border}`,
                background: on ? "#111317" : "#fff",
                color: on ? "#fff" : C.text,
                borderRadius: 999, padding: "8px 16px", fontSize: 13.5, fontWeight: 500,
              }}
            >
              {label}
            </a>
          );
        })}
      </nav>

      <Note tone="bad">{error}</Note>
      <div style={{ marginTop: 12 }}>{children({ api, onError })}</div>
    </div>
  );
}
