import Marketing from "../components/Marketing";

export const metadata = {
  title: "EasyCall — Delete your account",
  description: "How to delete your EasyCall account, and what happens to your data when you do.",
};

// The page the Google Play listing links to for account deletion. Play asks
// that it name the app as the listing does, put the steps up front, and say
// what is deleted, what is kept and for how long — so that is its order.
// Written from what account deletion actually does (DELETE /me in the
// EasyDeck API, which the app calls), not from a template.
const h2 = { fontSize: 22, margin: "38px 0 10px" };
const list = { paddingLeft: 20, color: "var(--body)", lineHeight: 1.7 };

export default function DeleteAccount() {
  return (
    <Marketing>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="EasyCall"
        width={72}
        height={72}
        style={{ display: "block", borderRadius: 16, marginBottom: 20 }}
      />
      <h1 style={{ fontSize: 40 }}>Delete your EasyCall account</h1>
      <p style={{ fontSize: 19, margin: "16px 0 8px" }}>
        EasyCall is made by Montigate LLC. Here is how to delete your account
        and everything in it, and what happens to your data when you do.
      </p>

      <h2 style={h2}>In the app — it takes a minute</h2>
      <ol style={list}>
        <li>Open <b>EasyCall</b> and sign in.</li>
        <li>Tap the <b>Settings</b> tab.</li>
        <li>Tap <b>Account</b>.</li>
        <li>Tap <b>Delete account</b>, then <b>Delete</b>.</li>
        <li>Confirm with <b>Delete everything</b>.</li>
      </ol>
      <p>
        Your account is deleted there and then. There is no waiting period, and
        it cannot be undone.
      </p>

      <h2 style={h2}>Without the app</h2>
      <p>
        If you have uninstalled EasyCall or can&apos;t sign in, email{" "}
        <a href="mailto:support@chatkit.cc?subject=Delete%20my%20EasyCall%20account">support@chatkit.cc</a>{" "}
        from the address you sign in with and ask us to delete your account.
        We delete it within 30 days and reply to confirm.
      </p>

      <h2 style={h2}>What is deleted</h2>
      <ul style={list}>
        <li><b>Your sign-in account</b> — your email address, name and password.</li>
        <li><b>Your call history</b> and <b>call recordings</b>, including the audio files.</li>
        <li><b>Your texts</b> and WhatsApp conversations.</li>
        <li><b>Your contacts</b>, and everything else you added in the app.</li>
        <li><b>Your phone numbers&apos; settings</b> and the Twilio details you connected.</li>
        <li><b>Your devices&apos; notification tokens</b>, so nothing is sent to your phone again.</li>
      </ul>

      <h2 style={h2}>What is kept, and for how long</h2>
      <ul style={list}>
        <li>
          <b>Your own Twilio account.</b> EasyCall connects to a Twilio account
          that belongs to you. Numbers you bought there, and the call logs,
          messages and recordings Twilio keeps in it, stay in that account
          until you remove them in Twilio&apos;s console.
        </li>
        <li>
          <b>Purchases.</b> If you subscribed, Apple or Google and our billing
          provider RevenueCat keep the purchase record, as billing, refunds and
          tax require. Deleting your account does not cancel a subscription —
          cancel it in your App Store or Google Play subscriptions.
        </li>
        <li>
          <b>Backups and logs.</b> Copies in our encrypted database backups,
          and server logs that can include phone numbers or IP addresses, expire
          on their own within 30 days.
        </li>
      </ul>
      <p>Nothing else is kept.</p>

      <h2 style={h2}>Questions</h2>
      <p>
        Email <a href="mailto:support@chatkit.cc">support@chatkit.cc</a>. More on
        what EasyCall stores and why is in the <a href="/privacy">privacy policy</a>.
      </p>
    </Marketing>
  );
}
