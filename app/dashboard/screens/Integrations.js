"use client";

import { useEffect, useState } from "react";
import { Button, C, Note, Table, card, input } from "../lib/ui";

// Twilio, and the numbers it holds. Everything else about the account lives in
// Twilio's own console; this is the part that has to be true here.
export default function Integrations({ api, onError }) {
  const [account, setAccount] = useState(null);
  const [numbers, setNumbers] = useState(null);
  const [sid, setSid] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = () => {
    api("/twilio/account").then(setAccount).catch((e) => onError(e.message));
    api("/numbers").then((b) => setNumbers(b.numbers ?? [])).catch(() => setNumbers([]));
  };
  useEffect(load, [api]);

  const connect = async () => {
    if (!sid.trim() || !token.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      await api("/twilio/account", {
        method: "POST",
        body: JSON.stringify({ account_sid: sid.trim(), auth_token: token.trim() }),
      });
      setSid(""); setToken("");
      setNote("Connected.");
      load();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await api("/twilio/account", { method: "DELETE" });
      load();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const connected = Boolean(account?.connected ?? account?.account_sid);

  const COLS = [
    ["Number", (r) => r.phone_number],
    ["Label", (r) => r.label ?? "—"],
    ["Primary", (r) => (r.is_primary ? "Yes" : "")],
    ["Status", (r) => (r.verified === false ? "Unverified" : "Ready")],
  ];

  return (
    <>
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Twilio</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>
          {connected
            ? `Connected${account?.account_sid ? ` · ${account.account_sid}` : ""}. Calls and texts go out through this account.`
            : "Not connected. Calls and texts need a Twilio account behind them."}
        </div>
        {connected ? (
          <div style={{ marginTop: 12 }}>
            <Button onClick={disconnect} disabled={busy} tone="bad">Disconnect</Button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, maxWidth: 420 }}>
            <input style={input} placeholder="Account SID" value={sid} onChange={(e) => setSid(e.target.value)} />
            <input style={input} placeholder="Auth token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
            <Button onClick={connect} disabled={busy || !sid.trim() || !token.trim()}>
              {busy ? "Connecting…" : "Connect"}
            </Button>
          </div>
        )}
        <Note tone="good">{note}</Note>
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, margin: "18px 0 8px" }}>Numbers</div>
      <Table cols={COLS} rows={numbers} empty="No numbers yet." />
    </>
  );
}
