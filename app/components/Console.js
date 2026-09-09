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
 * Stacked rather than side by side, and in that order: the numbers are a
 * glance, the keypad is the work. A strip of figures across the top reads in
 * one pass and then gets out of the way, which is why `Overview` draws itself
 * small here — four tiles the height of a line of text, not four cards.
 */
export default function Console(props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Overview {...props} compact />
      <Phone {...props} />
    </div>
  );
}
