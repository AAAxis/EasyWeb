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
 * control, not a report: the stats reflow, the keypad does not. Under 860px
 * the columns stack, phone first — on a narrow screen the thing you touch
 * should not be below the thing you read.
 *
 * A grid rather than a wrapping flex row. `flex-wrap: wrap-reverse` gets the
 * keypad above the stats when they stack, but it does it by reversing the
 * cross axis — which also turns `align-items: flex-start` into *bottom*, and
 * the stats sank to sit level with the foot of the keypad, a hand's height of
 * blank above them. Stacking order is a job for `order` in a media query; it
 * should not be paid for with the alignment of the row.
 */
export default function Console(props) {
  return (
    <>
      <style>{`
        .ec-console {
          display: grid;
          /* 360px matches the keypad card's own max width, so the column and
             the card agree rather than leaving a strip of dead grid beside it. */
          grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 860px) {
          .ec-console { grid-template-columns: minmax(0, 1fr); }
          .ec-console > .ec-console-phone { order: -1; }
        }
      `}</style>
      <div className="ec-console">
        <div style={{ minWidth: 0 }}>
          <Overview {...props} />
        </div>
        <div className="ec-console-phone" style={{ minWidth: 0 }}>
          <Phone {...props} />
        </div>
      </div>
    </>
  );
}
