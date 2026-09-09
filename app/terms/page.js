import Marketing from "../components/Marketing";
export const metadata = { title: "EasyCall — Terms" };

export default function Terms() {
  return (
    <Marketing>
      <h1 style={{ fontSize: 40 }}>Terms</h1>
      <p style={{ fontSize: 19, margin: "16px 0 8px" }}>The short version of what you agree to by using EasyCall.</p>

      <h2 style={{ fontSize: 22, margin: "38px 0 10px" }}>The service</h2>
      <p>
        EasyCall gives you a phone number and lets you make calls and send texts
        with it. Calls and texts are carried over the internet and by a telephone
        carrier, so they depend on your connection and on that carrier.
      </p>

      <h2 style={{ fontSize: 22, margin: "38px 0 10px" }}>What you agree to</h2>
      <ul style={{ paddingLeft: 20, color: "var(--body)", lineHeight: 1.7 }}>
        <li>Not to use the service for unsolicited bulk calling or texting.</li>
        <li>Not to use it to harass, defraud or impersonate anyone.</li>
        <li>To follow the law where you are about recording calls — see the privacy page.</li>
        <li>To be responsible for what is sent or said from your number.</li>
      </ul>

      <h2 style={{ fontSize: 22, margin: "38px 0 10px" }}>Emergency calls</h2>
      <p>
        <b>EasyCall does not replace your normal phone service and cannot be
        relied on to reach emergency services.</b> Use your carrier's dialler for
        emergencies.
      </p>

      <h2 style={{ fontSize: 22, margin: "38px 0 10px" }}>Paying</h2>
      <p>
        Subscriptions are billed through your Apple account and renew until you
        cancel. Cancel any time in your Apple subscription settings; cancelling
        stops the next renewal.
      </p>

      <h2 style={{ fontSize: 22, margin: "38px 0 10px" }}>Ending it</h2>
      <p>
        You can delete your account at any time from Settings → Legal → Delete
        account, which ends this agreement and removes your data. We can suspend
        an account that is being used for the things listed above.
      </p>

      <h2 style={{ fontSize: 22, margin: "38px 0 10px" }}>Contact</h2>
      <p><a href="mailto:support@chatkit.cc">support@chatkit.cc</a></p>
    </Marketing>
  );
}
