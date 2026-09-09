"use client";

import { useEffect, useState } from "react";
import { Button, C, Note, Table, card, input } from "../lib/ui";

// Two jobs, not two rivals.
//
// Twilio is the dialler: it mints the voice token, holds the browser's WebRTC
// leg, wakes the phone through push and drives CallKit. Without it there is no
// softphone on either end — DIDLogic publishes no WebSocket endpoint, so a
// browser cannot register to it at all.
//
// The carrier is where numbers come from, and there is one at a time. That part
// is a trunk, not a list of integrations: two at once means every outbound call
// has a question to answer about which one it leaves by, so the server refuses
// a second and swapping is disconnect-then-connect.
//
// Listing them side by side as if you pick one was the confusion this screen
// used to cause.
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

const money = (value) =>
  value === null || value === undefined ? "—" : `$${Number(value).toFixed(2)}`;

// Everything that carries a call, in one table: a row per trunk, against the
// balance that pays for it. They were two figures in two cards, which is two
// places to look for the same question — what is left, and on which account.
const TRUNK_COLS = [
  ["Trunk", (r) => r.name],
  ["Balance", (r) => (
    <span style={{ fontWeight: 600, color: r.balance !== null && r.balance < 5 ? C.bad : C.text }}>
      {money(r.balance)}
    </span>
  )],
];

export default function Integrations({ api, onError }) {
  const [carrier, setCarrier] = useState(undefined); // undefined = loading, null = none
  // The house carrier: the platform's own account, handed to every workspace.
  // Nothing to connect, nothing to disconnect, and no key for anyone to paste.
  const [managed, setManaged] = useState(false);
  const [choices, setChoices] = useState(["twilio"]);
  const [numbers, setNumbers] = useState(null);
  const [balance, setBalance] = useState(null);
  // Twilio's own figure, kept apart from the carrier's — two accounts, two
  // balances, and running one down does nothing for the other.
  const [dialTwilio, setDialTwilio] = useState(null);
  const [choice, setChoice] = useState("twilio");
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [recording, setRecording] = useState(null);

  const load = () => {
    api("/providers")
      .then((b) => {
        setCarrier(b.provider ?? null);
        setManaged(Boolean(b.managed));
        if (b.choices?.length) setChoices(b.choices);
      })
      .catch((e) => { setCarrier(null); onError(e.message); });
    api("/numbers").then((b) => setNumbers(b.numbers ?? [])).catch(() => setNumbers([]));
    // Balance is asked for here and nowhere else: it is an operator's number,
    // not something to put in front of someone mid-call, so the phone app never
    // requests it.
    api("/providers/balance").then((b) => setBalance(b.balance)).catch(() => setBalance(null));
    // The dialler is its own question: a workspace can have a carrier and still
    // not be able to place a call. The balance answers it — Twilio only reports
    // one for an account we can actually authenticate as.
    api("/twilio/account")
      .then((b) => setDialTwilio(typeof b?.balance === "number" ? b.balance : null))
      .catch(() => setDialTwilio(null));
    api("/settings/recording").then(setRecording).catch(() => setRecording(null));
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

  const toggleRecording = async () => {
    const next = !recording?.enabled;
    setRecording((current) => ({ ...current, enabled: next }));
    try {
      await api("/settings/recording", { method: "PUT", body: JSON.stringify({ enabled: next }) });
    } catch (e) {
      setRecording((current) => ({ ...current, enabled: !next }));
      onError(e.message);
    }
  };

  if (carrier === undefined) return <div style={card}>Loading…</div>;

  const bare = (n) => String(n ?? "").replace(/^\+/, "");
  const active = bare(carrier?.active_number);

  const setActive = async (number) => {
    try {
      const b = await api("/providers/active", {
        method: "POST",
        body: JSON.stringify({ number: bare(number) === active ? null : number }),
      });
      setCarrier(b.provider);
    } catch (e) {
      onError(e.message);
    }
  };

  // Which number the history screens are about. With one number there is
  // nothing to choose, so it reads as a state rather than a control.
  const NUMBER_COLS = [
    ["Number", (r) => r.phone_number],
    ["Where", (r) => r.label ?? "—"],
    ["Channels", (r) => r.channels ?? "—"],
    ["Status", (r) => (r.verified === false ? "Unverified" : "Ready")],
    ["", (r) => {
      const on = bare(r.phone_number) === active;
      return (
        <button
          onClick={() => setActive(r.phone_number)}
          style={{
            border: `1px solid ${on ? C.good : C.border}`,
            background: on ? "#E3F7F1" : "#fff",
            color: on ? C.good : C.muted,
            borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}
        >
          {on ? "In use" : "Use this"}
        </button>
      );
    }],
  ];

  // A row per trunk, and the carrier is one trunk however many SIP accounts sit
  // on it — the balance belongs to the account, so a row each would repeat one
  // figure into a total that does not exist.
  const trunkRows = [
    ...(dialTwilio === null ? [] : [{ id: "twilio", name: "Twilio", balance: dialTwilio }]),
    ...(carrier ? [{
      id: "carrier",
      name: carrier.provider === "didlogic" ? "DIDLogic" : (carrier.label ?? carrier.provider),
      balance,
    }] : []),
  ];

  return (
    <>
      {/* No cards describing the dialler and the carrier. The table below names
          both and says what is left on each, which is what the prose was
          circling. What stays is what you can act on: disconnecting a carrier
          you connected, and connecting one when there is none. */}
      {carrier ? (
        managed ? null : (
          <div style={{ ...card, marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200, fontSize: 15, fontWeight: 700, color: C.text }}>
              {carrier.label ?? carrier.provider}
            </div>
            <Button onClick={disconnect} disabled={busy} tone="bad">Disconnect</Button>
          </div>
        )
      ) : (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Connect a carrier</div>
          <div style={{ fontSize: 12.5, color: C.muted, margin: "4px 0 14px" }}>
            Nothing is connected, so calls and texts have nowhere to go out.
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {Object.entries(CARRIERS).filter(([key]) => choices.includes(key)).map(([key, c]) => (
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

      {recording ? (
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Record calls</div>
            <div style={{ fontSize: 12.5, color: C.muted }}>
              Off unless you turn it on. Everyone on the call may need to be told — the law differs by country.
            </div>
          </div>
          <Button onClick={toggleRecording}>{recording.enabled ? "On" : "Off"}</Button>
        </div>
      ) : null}

      {trunkRows.length ? (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, margin: "18px 0 8px" }}>Trunks</div>
          <Table cols={TRUNK_COLS} rows={trunkRows} />
        </>
      ) : null}

      <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, margin: "18px 0 8px" }}>Numbers</div>
      <Table cols={NUMBER_COLS} rows={numbers} empty="No numbers on this account yet." />
    </>
  );
}
