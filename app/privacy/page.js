import Marketing from "../components/Marketing";
export const metadata = { title: "EasyCall — Privacy" };

// Written from what the app actually does, not from a template: every item
// below corresponds to something the code stores or sends. App Review checks
// that this page exists and that it matches the app's behaviour.
export default function Privacy() {
  return (
    <Marketing>
      <h1 style={{ fontSize: 40 }}>Privacy</h1>
      <p style={{ fontSize: 19, margin: "16px 0 8px" }}>
        What EasyCall stores, why, and how to get rid of it.
      </p>

      <h2 style={{ fontSize: 22, margin: "38px 0 10px" }}>What we store</h2>
      <ul style={{ paddingLeft: 20, color: "var(--body)", lineHeight: 1.7 }}>
        <li><b>Your account.</b> The email address you sign in with.</li>
        <li><b>Your phone number.</b> The number you buy or connect, so calls and texts can use it.</li>
        <li><b>Call records.</b> The numbers involved, whether the call was in or out, when it started, and how long it lasted.</li>
        <li><b>Recordings.</b> Only when you turn recording on. Audio is stored so you can play it back, and deleting a recording deletes the audio.</li>
        <li><b>Messages.</b> The texts you send and receive on your number, so the thread is there when you come back.</li>
        <li><b>Contacts you add</b> inside the app — a name and a number.</li>
        <li><b>A notification token</b>, so the phone can ring when a call comes in.</li>
      </ul>

      <h2 style={{ fontSize: 22, margin: "38px 0 10px" }}>Who else sees it</h2>
      <ul style={{ paddingLeft: 20, color: "var(--body)", lineHeight: 1.7 }}>
        <li><b>Twilio</b> carries the calls and texts themselves. A phone call cannot happen without a carrier.</li>
        <li><b>Google Firebase</b> handles signing in and delivering notifications.</li>
        <li><b>Supabase</b> hosts the database and the recording storage.</li>
        <li><b>RevenueCat</b> handles subscriptions, if you buy one.</li>
      </ul>
      <p>
        We do not sell your data, and we do not use the content of your calls or
        messages for advertising.
      </p>

      <h2 style={{ fontSize: 22, margin: "38px 0 10px" }}>Recording calls</h2>
      <p>
        Recording is off until you turn it on. Laws about recording a call differ
        by country and by state — in many places every participant has to know.
        You are responsible for using it lawfully where you are.
      </p>

      <h2 style={{ fontSize: 22, margin: "38px 0 10px" }}>Deleting it</h2>
      <p>
        You can delete your account from inside the app: <b>Settings → Account →
        Delete account</b>. That removes your account and the data above,
        permanently, and it cannot be undone. You do not need to email anyone to
        do it. The steps, the way to ask without the app, and what is kept are
        on <a href="/delete-account">Delete your account</a>.
      </p>

      <h2 style={{ fontSize: 22, margin: "38px 0 10px" }}>Getting in touch</h2>
      <p>
        Questions about any of this: <a href="mailto:support@chatkit.cc">support@chatkit.cc</a>.
      </p>
    </Marketing>
  );
}
