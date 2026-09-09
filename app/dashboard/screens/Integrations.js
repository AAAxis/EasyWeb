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

// Everything that carries a call, in one table: the dialler and the carrier's
// trunks, each against the balance that pays for it. They were two figures in
// two cards, which is two places to look for the same question — what is left,
// and on which account.
const TRUNK_COLS = [
  ["Trunk", (r) => r.name],
  ["Carrier", (r) => r.carrier],
  ["Caller ID", (r) => r.callerId || "—"],
  ["Balance", (r) => (
    r.shared
      ? <span style={{ color: C.faint }}>same account</span>
      : <span style={{ fontWeight: 600, color: r.balance !== null && r.balance < 5 ? C.bad : C.text }}>{money(r.balance)}</span>
  )],
];

export default function Integrations({ api, onError }) {
  const [carrier, setCarrier] = useState(undefined); // undefined = loading, null = none
  // The house carrier: the platform's own account, handed to every workspace.
  // Nothing to connect, nothing to disconnect, and no key for anyone to paste.
  const [managed, setManaged] = useState(false);
  const [choices, setChoices] = useState(["twilio"]);
  const [numbers, setNumbers] = useState(null);
  const [trunks, setTrunks] = useState([]);
  const [balance, setBalance] = useState(null);
  // Twilio's own figure, kept apart from the carrier's — two accounts, two
  // balances, and running one down does nothing for the other.
  const [dialTwilio, setDialTwilio] = useState(null);
  const [choice, setChoice] = useState("twilio");
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = () => {
    api("/providers")
      .then((b) => {
        setCarrier(b.provider ?? null);
        setManaged(Boolean(b.managed));
        if (b.choices?.length) setChoices(b.choices);
      })
      .catch((e) => { setCarrier(null); onError(e.message); });
    api("/numbers").then((b) => setNumbers(b.numbers ?? [])).catch(() => setNumbers([]));
    api("/providers/trunks").then((b) => setTrunks(b.trunks ?? [])).catch(() => setTrunks([]));
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

  // Twilio first: it is what holds the call up, whoever carries it. Then the
  // carrier's trunks, which share one account balance between them — so the
  // figure goes on the first and the rest say so, rather than repeating into a
  // total that does not exist.
  const primary = numbers?.find((n) => n.is_primary)?.phone_number ?? numbers?.[0]?.phone_number ?? null;
  const trunkRows = [
    ...(dialTwilio === null ? [] : [{
      id: "twilio", name: "Dialler", carrier: "Twilio",
      callerId: primary, balance: dialTwilio, shared: false,
    }]),
    ...trunks.map((t, i) => ({
      id: `dl-${t.id}`, name: t.label || `Trunk ${t.id}`,
      carrier: carrier?.provider === "didlogic" ? "DIDLogic" : (carrier?.provider ?? "Carrier"),
      callerId: t.callerId, balance: i === 0 ? balance : null, shared: i > 0,
    })),
  ];
  const sharedBalance = trunkRows.some((r) => r.shared);

  return (
    <>
      <div style={{ ...card, marginBottom: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Dialler</div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>
            Twilio carries the app and the browser onto the call. It is separate
            from where your numbers come from, and both are needed.
          </div>
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, margin: "0 0 8px" }}>
        Numbers — one carrier at a time
      </div>

      {carrier ? (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
                {managed ? "Numbers" : (carrier.label ?? carrier.provider)}
              </div>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>
                {managed || !carrier.connected_at
                  ? "Calls and texts go out through this."
                  : `Connected ${new Date(carrier.connected_at).toLocaleDateString()} · calls and texts go out through this.`}
              </div>
            </div>
            {managed ? null : (
              <Button onClick={disconnect} disabled={busy} tone="bad">Disconnect</Button>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 12 }}>
            {managed
              ? "Included with your account — your numbers and calls come through it."
              : "One carrier at a time. Disconnect this to connect another."}
          </div>
        </div>
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

      {trunkRows.length ? (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, margin: "18px 0 8px" }}>Trunks</div>
          <Table cols={TRUNK_COLS} rows={trunkRows} />
          {sharedBalance ? (
            <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>
              A carrier&apos;s balance belongs to its account, not to each trunk on it — shown once
              so several trunks do not read as several balances.
            </div>
          ) : null}
        </>
      ) : null}

      <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, margin: "18px 0 8px" }}>Numbers</div>
      <Table cols={NUMBER_COLS} rows={numbers} empty="No numbers on this account yet." />
    </>
  );
}
