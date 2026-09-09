"use client";

import { useEffect, useState } from "react";
import { Button, C, Table, card, dur, when } from "../lib/ui";

export default function Recordings({ api, onError }) {
  const [rows, setRows] = useState(null);
  const [settings, setSettings] = useState(null);
  const [playing, setPlaying] = useState(null);

  const load = () => api("/recordings?limit=100")
    .then((b) => setRows(b.recordings ?? []))
    .catch((e) => { setRows([]); onError(e.message); });

  useEffect(() => {
    load();
    api("/settings/recording").then(setSettings).catch(() => {});
  }, [api]);

  // The URL is signed and short-lived, so it is fetched per play rather than
  // held on the row.
  const play = async (row) => {
    try {
      const { url } = await api(`/recordings/${row.id}/url`);
      setPlaying({ id: row.id, url });
    } catch (e) {
      onError(e.message);
    }
  };

  const remove = async (row) => {
    try {
      await api(`/recordings/${row.id}`, { method: "DELETE" });
      setRows((current) => (current ?? []).filter((r) => r.id !== row.id));
      if (playing?.id === row.id) setPlaying(null);
    } catch (e) {
      onError(e.message);
    }
  };

  const toggle = async () => {
    const next = !settings?.enabled;
    setSettings((s) => ({ ...s, enabled: next }));
    try {
      await api("/settings/recording", { method: "PUT", body: JSON.stringify({ enabled: next }) });
    } catch (e) {
      setSettings((s) => ({ ...s, enabled: !next }));
      onError(e.message);
    }
  };

  const COLS = [
    ["When", (r) => when(r.started_at ?? r.created_at)],
    ["Who", (r) => r.contact_name ?? r.from_number ?? "—"],
    ["Length", (r) => dur(r.duration_seconds)],
    ["State", (r) => r.status ?? "—"],
    ["", (r) => (
      <span style={{ display: "flex", gap: 8 }}>
        <Button onClick={() => play(r)} disabled={r.status !== "stored"}>Play</Button>
        <Button onClick={() => remove(r)} tone="bad">Delete</Button>
      </span>
    )],
  ];

  return (
    <>
      {settings ? (
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Record calls</div>
            <div style={{ fontSize: 12.5, color: C.muted }}>
              Off unless you turn it on. Everyone on the call may need to be told — the law differs by country.
            </div>
          </div>
          <Button onClick={toggle}>{settings.enabled ? "On" : "Off"}</Button>
        </div>
      ) : null}

      {playing ? (
        <div style={{ ...card, marginBottom: 12 }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio src={playing.url} controls autoPlay style={{ width: "100%" }} />
        </div>
      ) : null}

      <Table cols={COLS} rows={rows} empty="Nothing recorded yet." />
    </>
  );
}
