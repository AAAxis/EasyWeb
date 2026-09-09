"use client";

import { useEffect, useState } from "react";
import { Table, dur, when } from "../lib/ui";

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
];

export default function Calls({ api, onError }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api("/calls?limit=100")
      .then((b) => setRows(b.calls ?? []))
      .catch((e) => { setRows([]); onError(e.message); });
  }, [api, onError]);
  return <Table cols={COLS} rows={rows} empty="No calls yet." />;
}
