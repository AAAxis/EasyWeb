import Marketing from "../components/Marketing";
import RequestForm from "./RequestForm";

export const metadata = {
  title: "EasyCall — Delete your account",
  description: "How to delete your EasyCall account, and what happens to your data when you do.",
};

// The page the Google Play listing links to for account deletion. Play asks
// that it name the app as the listing does, put the way to delete up front —
// including a way to ask without the app — and say what is deleted, what is
// kept and for how long. Written from what account deletion actually does
// (DELETE /me in the EasyDeck API, which the app calls), not from a template.
const card = {
  border: "1px solid var(--line)", borderRadius: 16, background: "#fff",
  padding: "24px 24px 20px", marginTop: 18,
};
const cardTitle = { fontSize: 19, margin: "0 0 4px", color: "var(--ink)" };
const cardLead = { margin: "0 0 16px", color: "var(--body)", fontSize: 15 };
const list = { margin: 0, paddingLeft: 20, color: "var(--body)", lineHeight: 1.75, fontSize: 15 };

const STEPS = [
  <>Open <b>EasyCall</b> and sign in.</>,
  <>Tap the <b>Settings</b> tab, then <b>Account</b>.</>,
  <>Tap <b>Delete account</b>, then <b>Delete</b>.</>,
  <>Confirm with <b>Delete everything</b>.</>,
];

export default function DeleteAccount() {
  return (
    <Marketing>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="EasyCall" width={64} height={64}
          style={{ borderRadius: 15, boxShadow: "0 4px 14px rgba(47,107,255,0.25)" }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--tint)", letterSpacing: "0.02em" }}>
            ACCOUNT DELETION
          </div>
          <h1 style={{ fontSize: 32, margin: "2px 0 0", color: "var(--ink)", lineHeight: 1.15 }}>
            Delete your EasyCall account
          </h1>
        </div>
      </div>
      <p style={{ fontSize: 16.5, color: "var(--body)", margin: "18px 0 0", lineHeight: 1.6 }}>
        EasyCall is made by Montigate LLC. You can delete your account and its
        data yourself in the app, or ask us to do it with the form below.
      </p>

      <section style={card}>
        <h2 style={cardTitle}>Delete it in the app</h2>
        <p style={cardLead}>Takes a minute. The account is deleted there and then, and it can&apos;t be undone.</p>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {STEPS.map((step, i) => (
            <li key={i} style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--body)", fontSize: 15 }}>
              <span style={{
                flex: "0 0 28px", height: 28, borderRadius: 14, background: "var(--wash)",
                color: "var(--tint)", fontWeight: 700, fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section style={card}>
        <h2 style={cardTitle}>Ask us to delete it</h2>
        <p style={cardLead}>
          No app, or can&apos;t sign in? Send this form. We email you a confirmation, delete the
          account within 30 days, and reply when it&apos;s done.
        </p>
        <RequestForm />
      </section>

      <section style={card}>
        <h2 style={cardTitle}>What is deleted</h2>
        <ul style={list}>
          <li>Your sign-in account — email address, name and password.</li>
          <li>Your call history and call recordings, including the audio files.</li>
          <li>Your texts and WhatsApp conversations.</li>
          <li>Your contacts, and everything else you added in the app.</li>
          <li>Your phone numbers&apos; settings and the Twilio details you connected.</li>
          <li>Your devices&apos; notification tokens.</li>
        </ul>
      </section>

      <section style={card}>
        <h2 style={cardTitle}>What is kept, and for how long</h2>
        <ul style={list}>
          <li>
            <b>Your own Twilio account.</b> EasyCall connects to a Twilio account that belongs
            to you. Numbers you bought there, and the call logs, messages and recordings Twilio
            keeps in it, stay until you remove them in Twilio&apos;s console.
          </li>
          <li>
            <b>Purchases.</b> If you subscribed, Apple or Google and our billing provider
            RevenueCat keep the purchase record, as billing, refunds and tax require. Deleting
            your account doesn&apos;t cancel a subscription — cancel it in your store&apos;s
            subscriptions.
          </li>
          <li>
            <b>Backups and logs.</b> Copies in encrypted database backups, and server logs that
            can include phone numbers or IP addresses, expire on their own within 30 days.
          </li>
        </ul>
        <p style={{ margin: "12px 0 0", color: "var(--body)", fontSize: 15 }}>Nothing else is kept.</p>
      </section>

      <p style={{ margin: "28px 0 8px", color: "var(--faint)", fontSize: 14 }}>
        Questions: <a href="mailto:support@chatkit.cc">support@chatkit.cc</a> ·{" "}
        <a href="/privacy">Privacy policy</a>
      </p>
    </Marketing>
  );
}
