"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, C, Modal, Table, dur, when } from "../lib/ui";

// The column stores what Twilio calls things; the table should not.
const OUTCOME = {
  in_progress: "In progress",
  completed: "Answered",
  no_answer: "No answer",
  busy: "Busy",
  failed: "Failed",
  canceled: "Cancelled",
};

// How far apart a carrier's clock and Twilio's may be and still be one call.
const NEAR_MS = 3 * 60 * 1000;

/**
 * The recording belonging to a call, if there is one.
 *
 * Two kinds of row arrive here. Ours carry the id the recording was filed
 * against, so they match outright. The carrier's own log does not — it has
 * never heard of Twilio's ids — so those fall back to the number and the
 * minute, which is the only thing the two records share.
 */
function recordingFor(row, recordings) {
  if (!recordings?.length) return null;
  if (typeof row.id === "number") {
    const byId = recordings.find((r) => r.call_id === row.id);
    if (byId) return byId;
  }
  const bare = (value) => String(value ?? "").replace(/\D/g, "");
  const at = new Date(row.started_at ?? row.created_at ?? 0).getTime();
  const other = bare(row.direction === "inbound" ? row.from_number : row.to_number);
  if (!other || !at) return null;
  return recordings.find((r) =>
    (bare(r.to_number) === other || bare(r.from_number) === other) &&
    Math.abs(new Date(r.started_at ?? r.created_at ?? 0).getTime() - at) < NEAR_MS) ?? null;
}

export default function Calls({ api, onError }) {
  const [rows, setRows] = useState(null);
  const [source, setSource] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [settings, setSettings] = useState(null);
  // The call whose details are open, and the signed URL being played for it.
  const [open, setOpen] = useState(null);
  const [playing, setPlaying] = useState(null);

  const load = useCallback(() => {
    api("/calls?limit=100")
      .then((b) => { setRows(b.calls ?? []); setSource(b.source ?? null); })
      .catch((e) => { setRows([]); onError(e.message); });
    api("/recordings?limit=100").then((b) => setRecordings(b.recordings ?? [])).catch(() => setRecordings([]));
    api("/settings/recording").then(setSettings).catch(() => {});
  }, [api, onError]);

  useEffect(load, [load]);

  // Signed and short-lived, so it is fetched per play rather than held on a row.
  const play = async (recording) => {
    try {
      const { url } = await api(`/recordings/${recording.id}/url`);
      setPlaying({ id: recording.id, url });
    } catch (e) {
      onError(e.message);
    }
  };

  const removeRecording = async (recording) => {
    try {
      await api(`/recordings/${recording.id}`, { method: "DELETE" });
      setRecordings((current) => current.filter((r) => r.id !== recording.id));
      setPlaying(null);
    } catch (e) {
      onError(e.message);
    }
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
    ["", (r) => (recordingFor(r, recordings) ? <span title="Recorded">●</span> : null)],
  ];

  const cols = source === "didlogic" ? COLS : COLS.filter(([label]) => label !== "Cost");
  const openRecording = open ? recordingFor(open, recordings) : null;

  const detail = (label, value) => (
    <div style={{ display: "flex", gap: 12, padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ width: 92, flexShrink: 0, fontSize: 12.5, color: C.faint }}>{label}</div>
      <div style={{ fontSize: 13.5, color: C.text, minWidth: 0, overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );

  const close = useCallback(() => { setOpen(null); setPlaying(null); }, []);

  return (
    <>
      <Table cols={cols} rows={rows} empty="No calls yet." onRow={setOpen} />

      {open ? (
        <Modal title={open.contact_name || open.to_number || "Call"} onClose={close}>
          {detail("When", when(open.started_at ?? open.created_at))}
          {detail("Direction", open.direction === "inbound" ? "Incoming" : "Outgoing")}
          {detail("From", open.from_number ?? "—")}
          {detail("To", open.to_number ?? "—")}
          {detail("Status", OUTCOME[open.status] ?? open.status ?? "—")}
          {detail("Length", dur(open.duration_seconds))}
          {open.amount == null ? null : detail("Cost", `$${Number(open.amount).toFixed(2)}`)}

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.faint, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
              Recording
            </div>
            {!openRecording ? (
              <div style={{ fontSize: 13, color: C.muted }}>
                {settings?.enabled
                  ? "Nothing was recorded for this call."
                  : "Recording is off, so this call was not recorded."}
              </div>
            ) : (
              <>
                {playing?.id === openRecording.id ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <audio src={playing.url} controls autoPlay style={{ width: "100%", marginBottom: 10 }} />
                ) : null}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Button onClick={() => play(openRecording)} disabled={openRecording.status !== "stored"}>
                    Play
                  </Button>
                  <Button onClick={() => removeRecording(openRecording)} tone="bad">Delete</Button>
                  <span style={{ fontSize: 12, color: C.faint }}>
                    {openRecording.status === "stored" ? dur(openRecording.duration_seconds) : openRecording.status}
                  </span>
                </div>
              </>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
