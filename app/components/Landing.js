"use client";

import { SignIn } from "../dashboard/lib/auth";
import { Footer, Mark, TopBar } from "./Chrome";

// What the app is, and the way in — on one page, next to each other. Someone
// arriving here is either signing in or deciding whether to, and splitting
// those across two URLs serves neither.

const FEATURES = [
  {
    title: "A number that is yours",
    body: "Pick one, or bring the one you already use. Calls arrive on your iPhone wherever you are.",
  },
  {
    title: "Texts in the same place",
    body: "Every message on that number sits in one thread, on the phone and on the web.",
  },
  {
    title: "Recordings when you want them",
    body: "Off until you turn it on. Play a call back later, or delete it and it is gone.",
  },
];

export default function Landing({ onSignIn }) {
  return (
    <>
      <TopBar />

      <section className="wrap" style={{ padding: "84px 24px 96px" }}>
        <div
          style={{
            display: "grid", gap: 64, alignItems: "center",
            gridTemplateColumns: "minmax(320px, 1.15fr) minmax(300px, 0.85fr)",
          }}
          className="hero"
        >
          <div>
            <div
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 22,
                background: "var(--wash)", border: "1px solid var(--line)", borderRadius: 999,
                padding: "6px 14px", fontSize: 13, fontWeight: 600, color: "var(--body)",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "#0CA678" }} />
              Calls and texts, one number
            </div>

            <h1 style={{ fontSize: "clamp(40px, 5.4vw, 66px)" }}>
              Your phone number,<br />on your phone.
            </h1>

            <p style={{ fontSize: 19, margin: "22px 0 32px", maxWidth: 520 }}>
              EasyCall gives you a real number to call and text from. Every
              conversation stays together — on the iPhone app, and here.
            </p>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <a className="btn btn-tint" href="#signin">Sign in</a>
              <a className="btn" style={{ background: "var(--wash)", color: "var(--ink)" }} href="/about">
                What it does
              </a>
            </div>
          </div>

          <div id="signin">
            <SignIn onSignIn={onSignIn} />
          </div>
        </div>
      </section>

      <section style={{ background: "var(--wash)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", padding: "76px 0" }}>
        <div className="wrap">
          <h2 style={{ fontSize: "clamp(28px, 3.4vw, 40px)", maxWidth: 620 }}>
            Everything a phone number should have done all along.
          </h2>
          <div
            style={{
              display: "grid", gap: 24, marginTop: 44,
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            }}
          >
            {FEATURES.map((f) => (
              <div key={f.title} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 18, padding: 26 }}>
                <Mark size={30} />
                <h3 style={{ fontSize: 19, margin: "18px 0 8px", fontWeight: 700 }}>{f.title}</h3>
                <p style={{ fontSize: 15 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap" style={{ padding: "84px 24px 0", textAlign: "center" }}>
        <h2 style={{ fontSize: "clamp(28px, 3.4vw, 40px)", maxWidth: 640, margin: "0 auto" }}>
          On the phone, and on the web.
        </h2>
        <p style={{ fontSize: 17, margin: "18px auto 0", maxWidth: 560 }}>
          The iPhone app makes the calls. This dashboard keeps the history, the
          recordings, the texts and the numbers — the same account, either end.
        </p>
      </section>

      <Footer />

      <style
        dangerouslySetInnerHTML={{
          __html: `@media (max-width: 900px) { .hero { grid-template-columns: 1fr !important; gap: 44px !important; } }`,
        }}
      />
    </>
  );
}
