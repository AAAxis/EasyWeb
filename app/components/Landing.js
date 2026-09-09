"use client";

import { SignIn } from "../dashboard/lib/auth";

// What the app is, and the way in — on one page, next to each other. Someone
// arriving here is either signing in or deciding whether to; splitting those
// across two URLs serves neither.
export default function Landing({ onSignIn }) {
  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 48, alignItems: "center", maxWidth: 1000, margin: "0 auto",
        padding: "10vh 24px 80px",
      }}
    >
      <div>
        <div
          style={{
            width: 76, height: 76, borderRadius: 18, marginBottom: 26,
            background: "linear-gradient(160deg, #4f8cff, #2f6bff)",
            display: "grid", placeItems: "center",
            boxShadow: "0 10px 30px rgba(47,107,255,0.25)",
          }}
        >
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6.6 3.5c.5-.2 1.1 0 1.4.5l1.7 3c.3.5.2 1.1-.2 1.5l-1.3 1.2c.9 1.9 2.4 3.4 4.3 4.3l1.2-1.3c.4-.4 1-.5 1.5-.2l3 1.7c.5.3.7.9.5 1.4l-.8 2c-.2.6-.8.9-1.4.8C10.6 17.4 6.6 13.4 5.3 6.5c-.1-.6.2-1.2.8-1.4l.5-1.6z"
              fill="#fff"
            />
          </svg>
        </div>
        <h1 style={{ fontSize: 38, lineHeight: 1.15, letterSpacing: "-0.02em", margin: "0 0 12px" }}>
          Your phone number, on your phone.
        </h1>
        <p style={{ fontSize: 18, margin: "0 0 20px" }}>
          Call and text from a real number. Record what matters, and keep every
          call and message in one place.
        </p>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>Calls in and out, over the internet.</li>
          <li>Texts from that same number.</li>
          <li>Recordings you can play back.</li>
        </ul>
      </div>

      <SignIn onSignIn={onSignIn} />
    </div>
  );
}
