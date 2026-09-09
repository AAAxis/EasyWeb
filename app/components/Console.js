"use client";

import Overview from "../dashboard/screens/Overview";
import Phone from "../dashboard/screens/Phone";

/**
 * The dashboard and the phone, on one screen.
 *
 * They were two tabs, which meant watching the numbers and being able to dial
 * were mutually exclusive — and a phone you have to navigate to is a phone
 * that misses calls, because the SDK only registers while its screen is
 * mounted. Together, the keypad is always live.
 *
 * The phone keeps its own column and a fixed-ish width because it is a
 * control, not a report: the stats reflow, the keypad does not. Under about
 * 800px the columns stack, phone first — on a narrow screen the thing you
 * touch should not be below the thing you read.
 */
export default function Console(props) {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap-reverse" }}>
      <div style={{ flex: "1 1 460px", minWidth: 0 }}>
        <Overview {...props} />
      </div>
      <div style={{ flex: "1 1 320px", minWidth: 300, maxWidth: 420 }}>
        <Phone {...props} />
      </div>
    </div>
  );
}
