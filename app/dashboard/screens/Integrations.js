"use client";

import { useEffect, useState } from "react";
import { Button, C, Note, Table, card, input } from "../lib/ui";

// Where numbers come from — one carrier at a time.
//
// This is a trunk, not a list of integrations. Two connected at once means
// every outbound call has a question to answer about which one it leaves by, so
// the server refuses a second and swapping is disconnect-then-connect: a
// deliberate moment rather than a silent re-route.
const CARRIERS = {
  didlogic: {
    name: "DIDLogic",
    blurb: "A SIP trunk and the numbers on it. Connect with the API key from app.didlogic.com.",
    fields: [["api_key", "API key", "password"]],
  },
  twilio: {
    name: "Twilio",
    blurb: "Calls and texts through your own Twilio account.",
    fields: [["account_sid", "Account SID", "text"], ["auth_token", "Auth token", "password"]],
  },
};

export default function Integrations({ api, onError }) {
  const [carrier, setCarrier] = useState(undefined); // undefined = loading, null = none
  const [numbers, setNumbers] = useState(null);
  const [trunks, setTrunks] = useState([]);
  const [balance, setBalance] = useState(null);
  const [choice, setChoice] = useState("didlogic");
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = () => {
    api("/providers")
      .then((b) => setCarrier(b.provider ?? null))
      .catch((e) => { setCarrier(null); onError(e.message); });
    api("/numbers").then((b) => setNumbers(b.numbers ?? [])).catch(() => setNumbers([]));
    api("/providers/trunks").then((b) => setTrunks(b.trunks ?? [])).catch(() => setTrunks([]));
    // Balance is asked for here and nowhere else: it is an operator's number,
    // not something to put in front of someone mid-call, so the phone app never
    // requests it.
    api("/providers/balance").then((b) => setBalance(b.balance)).catch(() => setBalance(null));
  };
  useEffect(load, [api]);

  const connect = async () => {
    setBusy(true);
    setNote(null);
    try {
      await api("/providers", { method: "POST", body: JSON.stringify({ provider: choice, ...values }) });
      setValues({});
      setNote(`${CARRIERS[choice].name} connected.`);
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
      await api("/providers", { method: "DELETE" });
      setBalance(null);
      setTrunks([]);
      setNote(null);
      load();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (carrier === undefined) return <div style={card}>Loading…</div>;

  const NUMBER_COLS = [
    ["Number", (r) => r.phone_number],
    ["Where", (r) => r.label ?? "—"],
    ["Channels", (r) => r.channels ?? "—"],
    ["Status", (r) => (r.verified === false ? "Unverified" : "Ready")],
  ];

  return (
    <>
      {carrier ? (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{carrier.label ?? carrier.provider}</div>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>
                Connected {new Date(carrier.connected_at).toLocaleDateString()} · calls and texts go out through this.
              </div>
            </div>
            {balance !== null && balance !== undefined ? (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.faint, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Balance
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: balance < 5 ? C.bad : C.text }}>
                  ${balance.toFixed(2)}
                </div>
              </div>
            ) : null}
            <Button onClick={disconnect} disabled={busy} tone="bad">Disconnect</Button>
          </div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 12 }}>
            One carrier at a time. Disconnect this to connect another.
          </div>
        </div>
      ) : (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Connect a carrier</div>
          <div style={{ fontSize: 12.5, color: C.muted, margin: "4px 0 14px" }}>
            Nothing is connected, so calls and texts have nowhere to go out.
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {Object.entries(CARRIERS).map(([key, c]) => (
              <button
                key={key}
                onClick={() => { setChoice(key); setValues({}); }}
                style={{
                  border: `1px solid ${choice === key ? "#111317" : C.border}`,
                  background: choice === key ? "#111317" : "#fff",
                  color: choice === key ? "#fff" : C.text,
                  borderRadius: 999, padding: "7px 15px", fontSize: 13, fontWeight: 500, cursor: "pointer",
                }}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10 }}>{CARRIERS[choice].blurb}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
            {CARRIERS[choice].fields.map(([name, label, type]) => (
              <input
                key={name}
                style={input}
                type={type}
                placeholder={label}
                value={values[name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
              />
            ))}
            <Button
              onClick={connect}
              disabled={busy || CARRIERS[choice].fields.some(([n]) => !(values[n] ?? "").trim())}
            >
              {busy ? "Checking…" : `Connect ${CARRIERS[choice].name}`}
            </Button>
          </div>
        </div>
      )}
      <Note tone="good">{note}</Note>

      {trunks.length ? (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, margin: "18px 0 8px" }}>Trunks</div>
          <Table
            cols={[["Name", (r) => r.label], ["Caller ID", (r) => r.callerId || "—"], ["ID", (r) => r.id]]}
            rows={trunks}
          />
        </>
      ) : null}

      <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, margin: "18px 0 8px" }}>Numbers</div>
      <Table cols={NUMBER_COLS} rows={numbers} empty="No numbers on this account yet." />
    </>
  );
}
