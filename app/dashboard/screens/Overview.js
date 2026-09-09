"use client";

import { useEffect, useState } from "react";
import { C, Skeleton, card, dur } from "../lib/ui";

// Four numbers, from what the other tabs already load. No separate stats
// endpoint: counting rows the dashboard is fetching anyway beats a query that
// can disagree with the list under it.
export default function Overview({ api, onError }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [calls, recordings, numbers, threads] = await Promise.all([
          api("/calls?limit=100").catch(() => ({ calls: [] })),
          api("/recordings?limit=100").catch(() => ({ recordings: [] })),
          api("/numbers").catch(() => ({ numbers: [] })),
          api("/conversations?limit=50").catch(() => ({ conversations: [] })),
        ]);
        const list = calls.calls ?? [];
        const week = Date.now() - 7 * 24 * 60 * 60 * 1000;
        setStats({
          calls: list.length,
          recent: list.filter((c) => new Date(c.started_at ?? c.created_at ?? 0).getTime() > week).length,
          minutes: list.reduce((sum, c) => sum + (Number(c.duration_seconds) || 0), 0),
          recordings: (recordings.recordings ?? []).length,
          numbers: (numbers.numbers ?? []).length,
          threads: (threads.conversations ?? []).filter((c) => c.channel !== "whatsapp").length,
        });
      } catch (e) {
        onError(e.message);
      }
    })();
  }, [api, onError]);

  if (!stats) return <Skeleton rows={3} />;

  const tiles = [
    ["Calls", stats.calls, `${stats.recent} this week`],
    ["Talk time", dur(stats.minutes), "across every call"],
    ["Recordings", stats.recordings, "stored"],
    ["Numbers", stats.numbers, stats.threads === 1 ? "1 text thread" : `${stats.threads} text threads`],
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
      {tiles.map(([label, value, sub]) => (
        <div key={label} style={card}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.faint, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: "-0.02em", margin: "6px 0 2px" }}>{value}</div>
          <div style={{ fontSize: 12.5, color: C.muted }}>{sub}</div>
        </div>
      ))}
    </div>
  );
}
