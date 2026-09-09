"use client";

import { useEffect, useRef, useState } from "react";
import { Button, C, Note, card, input } from "../lib/ui";

// A softphone in the page.
//
// The Chrome extension does this from an offscreen document, which is a
// Manifest V3 workaround — a service worker cannot hold a WebRTC connection. A
// web page has no such problem, so the SDK runs here directly: no extension to
// install, no iframe to embed.
//
// The token comes from POST /voice/token, and the TwiML app it is minted
// against points at the same /twilio/voice handler the phone app dials
// through — so a call from this keypad and a call from the app are the same
// call, logged the same way.
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

// How long a press on 0 has to last to mean +. The same gesture every phone
// keypad uses, so it needs no explaining — but it does need labelling, which is
// the small + under the 0.
const HOLD_MS = 450;

/**
 * E.164, or as close as the digits allow.
 *
 * Twilio rejects anything else, and it rejects it after the call has been
 * placed — so a number typed without a country code failed silently, as a dead
 * call rather than as a message. The phone app has normalised for a while; the
 * browser was dialling whatever was in the box.
 */
const normalize = (input) => {
  const digits = String(input ?? "").trim().replace(/[^\d+]/g, "");
  if (!digits) return "";
  return digits.startsWith("+") ? digits : `+${digits.replace(/^0+/, "")}`;
};

export default function Phone({ api, onError }) {
  const [number, setNumber] = useState("");
  // Set while a press on 0 is being held, and cleared by the press that
  // follows — so the release that produced a + does not also type a 0.
  const hold = useRef(null);
  const [state, setState] = useState("loading"); // loading | ready | calling | on | error
  const [incoming, setIncoming] = useState(null);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [note, setNote] = useState(null);
  const device = useRef(null);
  const call = useRef(null);
  const logged = useRef(null);   // the row this call is being written to
  const startedAt = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { token } = await api("/voice/token", { method: "POST", body: JSON.stringify({}) });
        // Imported here rather than at the top: the SDK touches browser APIs on
        // load, and this file is rendered on the server first.
        const { Device } = await import("@twilio/voice-sdk");
        if (!alive) return;
        const d = new Device(token, { logLevel: "error", codecPreferences: ["opus", "pcmu"] });
        d.on("registered", () => setState("ready"));
        d.on("error", (e) => { setState("error"); onError(e?.message ?? "The phone could not connect."); });
        d.on("incoming", (c) => {
          setIncoming(c);
          c.on("disconnect", () => setIncoming(null));
          c.on("cancel", () => setIncoming(null));
        });
        await d.register();
        device.current = d;
      } catch (e) {
        setState("error");
        onError(e?.message ?? "Couldn't start the phone.");
      }
    })();
    return () => { alive = false; device.current?.destroy(); };
  }, [api, onError]);

  // The timer only runs while a call is up.
  useEffect(() => {
    if (state !== "on") { setSeconds(0); return; }
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  /**
   * Closes the row the dial opened.
   *
   * Twilio's callback is the authoritative account of a call and will refine
   * this — but it only exists once the far leg does, and a call abandoned while
   * it rings never produces one. Without this, those rows sat at `in_progress`
   * with no duration for good. The sid is sent along so the callback, when
   * there is one, lands on this row rather than beside it.
   */
  const finish = async (status, c) => {
    const pending = logged.current;
    logged.current = null;
    if (!pending) return;                      // an incoming call: nothing of ours to close
    const id = await pending;
    if (!id) return;
    const seconds = startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0;
    startedAt.current = null;
    await api(`/calls/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        duration_seconds: seconds,
        ended_at: new Date().toISOString(),
        provider_call_sid: c?.parameters?.CallSid ?? undefined,
      }),
    }).catch(() => {});
  };

  const attach = (c) => {
    call.current = c;
    c.on("accept", () => { startedAt.current = Date.now(); setState("on"); });
    c.on("disconnect", () => { setState("ready"); call.current = null; setMuted(false); finish("completed", c); });
    c.on("cancel", () => { setState("ready"); call.current = null; finish("no_answer", c); });
    c.on("reject", () => { setState("ready"); call.current = null; finish("no_answer", c); });
    c.on("error", () => { setState("ready"); call.current = null; finish("failed", c); });
  };

  const dial = async () => {
    const to = normalize(number);
    if (!to || !device.current) return;
    setState("calling");
    setNote(null);
    try {
      // The row exists from the moment it is dialled, the same as the app does
      // it. Its id is kept so that hanging up can close it, whatever Twilio
      // does or does not report afterwards.
      logged.current = api("/calls", {
        method: "POST",
        body: JSON.stringify({ direction: "outbound", to_number: to, status: "in_progress" }),
      }).then((b) => b.call?.id ?? null).catch(() => null);
      startedAt.current = null;
      attach(await device.current.connect({ params: { To: to } }));
    } catch (e) {
      setState("ready");
      await finish("failed", null);
      onError(e?.message ?? "The call could not be placed.");
    }
  };

  const hangUp = () => { call.current?.disconnect(); setState("ready"); };
  const answer = () => { attach(incoming); incoming.accept(); setIncoming(null); };
  const decline = () => { incoming.reject(); setIncoming(null); };
  const toggleMute = () => {
    if (!call.current) return;
    const next = !muted;
    call.current.mute(next);
    setMuted(next);
  };

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const status = {
    loading: "Starting the phone…",
    ready: "Ready",
    calling: "Calling…",
    on: clock,
    error: "Not available",
  }[state];

  return (
    <div style={{ maxWidth: 360 }}>
      <div style={{ ...card, textAlign: "center" }}>
        <div style={{ fontSize: 12.5, color: state === "on" ? C.good : C.muted, fontWeight: 600, minHeight: 18 }}>
          {status}
        </div>

        <input
          style={{ ...input, fontSize: 24, textAlign: "center", border: "none", fontWeight: 600, letterSpacing: "0.02em", padding: "14px 0" }}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && dial()}
          placeholder="+1 555 000 0000"
          inputMode="tel"
        />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, margin: "10px 0 16px" }}>
          {KEYS.map((k) => {
            // Holding 0 types +, as it does on a phone. In a call the keypad is
            // sending DTMF, where + is not a tone and the hold means nothing.
            const holds = k === "0" && state !== "on";
            const press = () => {
              if (state === "on") { call.current?.sendDigits(k); return; }
              if (hold.current === "used") { hold.current = null; return; }
              setNumber((n) => n + k);
            };
            return (
              <button
                key={k}
                onClick={press}
                onPointerDown={holds ? () => {
                  hold.current = setTimeout(() => {
                    hold.current = "used";
                    setNumber((n) => (n.includes("+") ? n : `+${n}`));
                  }, HOLD_MS);
                } : undefined}
                onPointerUp={holds ? () => {
                  if (hold.current && hold.current !== "used") clearTimeout(hold.current);
                } : undefined}
                onPointerLeave={holds ? () => {
                  if (hold.current && hold.current !== "used") { clearTimeout(hold.current); hold.current = null; }
                } : undefined}
                onContextMenu={holds ? (e) => e.preventDefault() : undefined}
                style={{
                  border: `1px solid ${C.border}`, background: "#fff", borderRadius: 12,
                  padding: holds ? "8px 0 6px" : "14px 0", fontSize: 19, fontWeight: 600,
                  color: C.text, cursor: "pointer", userSelect: "none", touchAction: "manipulation",
                }}
              >
                {k}
                {holds ? (
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: C.faint, marginTop: -1 }}>+</div>
                ) : null}
              </button>
            );
          })}
        </div>

        {state === "on" || state === "calling" ? (
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <Button onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</Button>
            <Button onClick={hangUp} tone="bad">Hang up</Button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <Button onClick={dial} disabled={state !== "ready" || !number.trim()}>Call</Button>
            <Button onClick={() => setNumber((n) => n.slice(0, -1))} disabled={!number}>⌫</Button>
          </div>
        )}
        <Note>{note}</Note>
      </div>

      {incoming ? (
        <div style={{ ...card, marginTop: 12, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
            {incoming.parameters?.From ?? "Someone"} is calling
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
            <Button onClick={answer}>Answer</Button>
            <Button onClick={decline} tone="bad">Decline</Button>
          </div>
        </div>
      ) : null}

      <div style={{ fontSize: 12, color: C.faint, marginTop: 12 }}>
        The browser will ask for the microphone the first time you call.
      </div>
    </div>
  );
}
