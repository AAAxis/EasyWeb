"use client";

import { useEffect, useState } from "react";
import { C, Table, dur, when } from "../lib/ui";

// The column stores what Twilio calls things; the table should not.
const OUTCOME = {
  in_progress: "In progress",
  completed: "Answered",
  no_answer: "No answer",
  busy: "Busy",
  failed: "Failed",
  canceled: "Cancelled",
};

const COLS = [
  ["When", (r) => when(r.started_at ?? r.created_at)],
  ["Direction", (r) => (r.direction === "inbound" ? "In" : "Out")],
  ["From", (r) => r.from_number ?? "—"],
  ["To", (r) => r.to_number ?? "—"],
  ["Who", (r) => r.contact_name ?? "—"],
  ["Status", (r) => OUTCOME[r.status] ?? r.status ?? "—"],
  ["Length", (r) => dur(r.duration_seconds)],
  // Only the carrier knows what a call cost, so this column only appears when
  // the carrier is the one answering.
  ["Cost", (r) => (r.amount == null ? "—" : `$${Number(r.amount).toFixed(2)}`)],
];

export default function Calls({ api, onError }) {
  const [rows, setRows] = useState(null);
  const [source, setSource] = useState(null);
  const [active, setActive] = useState(null);
  useEffect(() => {
    api("/calls?limit=100")
      .then((b) => { setRows(b.calls ?? []); setSource(b.source ?? null); setActive(b.active_number ?? null); })
      .catch((e) => { setRows([]); onError(e.message); });
  }, [api, onError]);
  const cols = source === "didlogic" ? COLS : COLS.filter(([label]) => label !== "Cost");
  return (
    <>
      {source === "didlogic" ? (
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10 }}>
          From your carrier — what was actually carried, and what it cost.
          {active ? <> Showing <b style={{ color: C.text }}>{active}</b> only; change it in Integrations.</> : null}
        </div>
      ) : null}
      <Table cols={cols} rows={rows} empty="No calls yet." />
    </>
  );
}
