"use client";

import Balance from "../dashboard/screens/Balance";
import Integrations from "../dashboard/screens/Integrations";

/**
 * The float, and what it pays for, on one screen.
 *
 * They were two tabs holding one subject. Three balances live here — the
 * OxaPay float you top up, Twilio's for carrying the call, the carrier's for
 * the number it goes out on — and reading them a tab apart is how you end up
 * topping up the wrong one. Money first, then the things that spend it.
 */
export default function Account(props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Balance {...props} />
      <Integrations {...props} />
    </div>
  );
}
