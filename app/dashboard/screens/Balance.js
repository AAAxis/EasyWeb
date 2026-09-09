"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, C, Note, Skeleton, card, input } from "../lib/ui";

// The crypto float, and the way to add to it.
//
// The figure comes from OxaPay rather than from a table here — OxaPay holds the
// money, so it is the one that can say how much. Topping up hands the payer
// over to OxaPay's own page, where they pick the coin.
const PRESETS = [25, 50, 100, 250];

// Crypto amounts are not money-with-two-decimals; 4.925 USDT is 4.925, and
// rounding it to 4.93 would be inventing a number.
const coin = (amount) =>
  Number(amount).toLocaleString(undefined, { maximumFractionDigits: 8 });

export default function Balance({ api, onError }) {
  const [state, setState] = useState(null);
  const [amount, setAmount] = useState("50");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(() => {
    api("/balance")
      .then(setState)
      .catch((e) => { setState({ connected: false, held: [] }); onError(e.message); });
  }, [api, onError]);

  useEffect(() => { load(); }, [load]);

  // Coming back from OxaPay's page. A payment can take a confirmation or two to
  // land, so this says what it knows rather than promising the balance has
  // already moved.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("topup")) return;
    setNote("Payment sent. The balance updates once the network confirms it — refresh in a minute.");
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const topUp = async () => {
    const usd = Number(amount);
    if (!Number.isFinite(usd) || usd <= 0) return;
    setBusy(true);
    setNote(null);
    try {
      const { url } = await api("/balance/topup", {
        method: "POST",
        body: JSON.stringify({
          amount: usd,
          return_url: `${window.location.origin}/balance?topup=done`,
        }),
      });
      window.location.href = url;
    } catch (e) {
      onError(e.message);
      setBusy(false);
    }
  };

  if (!state) return <Skeleton rows={3} />;

  if (!state.connected) {
    return (
      <div style={{ ...card, color: C.muted, fontSize: 13.5 }}>
        OxaPay isn&apos;t connected. Set <code>OXAPAY_GENERAL_API_KEY</code> and{" "}
        <code>OXAPAY_MERCHANT_API_KEY</code> and this fills in.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ ...card, flex: "1 1 320px", minWidth: 280 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.faint, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Balance
        </div>

        {state.held.length === 0 ? (
          <div style={{ fontSize: 13.5, color: C.muted, marginTop: 10 }}>
            Nothing in the account yet.
          </div>
        ) : (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {state.held.map((row, i) => (
              <div key={row.currency} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: i === 0 ? 30 : 19, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>
                  {coin(row.amount)}
                </span>
                <span style={{ fontSize: i === 0 ? 14 : 12.5, fontWeight: 600, color: C.muted }}>
                  {row.currency}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 12, color: C.faint, marginTop: 12 }}>
          Held at OxaPay{state.currencies ? ` · ${state.currencies} currencies accepted` : ""}.
        </div>
      </div>

      <div style={{ ...card, flex: "1 1 320px", minWidth: 280 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>Top up</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
          Pay in any coin OxaPay takes. You&apos;ll finish on their page.
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0" }}>
          {PRESETS.map((value) => {
            const on = Number(amount) === value;
            return (
              <button
                key={value}
                onClick={() => setAmount(String(value))}
                style={{
                  border: `1px solid ${on ? "#111317" : C.border}`,
                  background: on ? "#111317" : "#fff",
                  color: on ? "#fff" : C.text,
                  borderRadius: 999, padding: "7px 15px", fontSize: 13.5, fontWeight: 500, cursor: "pointer",
                }}
              >
                ${value}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...input, flex: 1 }}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && topUp()}
            inputMode="decimal"
            aria-label="Amount in US dollars"
            placeholder="50"
          />
          <Button onClick={topUp} disabled={busy || !Number(amount)}>
            {busy ? "…" : "Top up"}
          </Button>
        </div>

        <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>$2 minimum, $500 maximum.</div>
        <Note>{note}</Note>
      </div>
    </div>
  );
}
