"use client";

import { useState } from "react";
import Calls from "../dashboard/screens/Calls";
import Sms from "../dashboard/screens/Sms";
import { C } from "../dashboard/lib/ui";

/**
 * Calls and texts, one screen and a switch.
 *
 * They are the same subject seen two ways — what happened with a number — and
 * two tabs made moving between them a navigation rather than a glance. The
 * switch is state and not an address: /calls and /sms both still resolve, and
 * each opens on its own side.
 */
export default function Activity({ initial = "calls", ...props }) {
  const [view, setView] = useState(initial);

  return (
    <>
      <div style={{ display: "inline-flex", gap: 3, padding: 3, marginBottom: 14, background: "#EEF0F3", borderRadius: 999 }}>
        {[["calls", "Calls"], ["sms", "SMS"]].map(([key, label]) => {
          const on = view === key;
          return (
            <button
              key={key}
              onClick={() => setView(key)}
              style={{
                border: "none", borderRadius: 999, padding: "6px 18px", cursor: "pointer",
                fontSize: 13.5, fontWeight: 600,
                background: on ? "#fff" : "transparent",
                color: on ? C.text : C.muted,
                boxShadow: on ? "0 1px 3px rgba(11,18,32,0.12)" : "none",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {view === "calls" ? <Calls {...props} /> : <Sms {...props} />}
    </>
  );
}
