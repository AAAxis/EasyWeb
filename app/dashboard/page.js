"use client";

import { useCallback, useState } from "react";
import { SignIn, useSession } from "./lib/auth";
import { useVoip } from "./lib/api";
import { C, Note, Skeleton } from "./lib/ui";
import Overview from "./screens/Overview";
import Calls from "./screens/Calls";
import Sms from "./screens/Sms";
import Recordings from "./screens/Recordings";
import Integrations from "./screens/Integrations";

const TABS = [
  ["overview", "Dashboard", Overview],
  ["calls", "Calls", Calls],
  ["sms", "SMS", Sms],
  ["recordings", "Recordings", Recordings],
  ["integrations", "Integrations", Integrations],
];

export default function Dashboard() {
  const { token, ready, signIn, signOut } = useSession();
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState(null);
  const api = useVoip(token);
  // Screens take this as a prop, so it has to keep its identity across renders
  // or every one of them re-fetches on every keystroke elsewhere.
  const onError = useCallback((message) => setError(message), []);

  if (!ready) return <div style={{ padding: 40 }}><Skeleton rows={3} /></div>;
  if (!token) return <SignIn onSignIn={signIn} />;

  const Screen = (TABS.find(([key]) => key === tab) ?? TABS[0])[2];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px 60px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>EasyCall</div>
        <button
          onClick={signOut}
          style={{ marginLeft: "auto", border: `1px solid ${C.border}`, background: C.surface, color: C.muted, borderRadius: 999, padding: "6px 14px", fontSize: 12.5, cursor: "pointer" }}
        >
          Sign out
        </button>
      </header>

      <nav style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setError(null); }}
            style={{
              border: `1px solid ${tab === key ? "#111317" : C.border}`,
              background: tab === key ? "#111317" : C.surface,
              color: tab === key ? "#fff" : C.text,
              borderRadius: 999, padding: "7px 15px", fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <Note tone="bad">{error}</Note>
      <div style={{ marginTop: 12 }}>
        <Screen api={api} onError={onError} />
      </div>
    </div>
  );
}
