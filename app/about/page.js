import Marketing from "../components/Marketing";
// The handset, drawn rather than loaded: the artwork lives in the app bundle
// and this page should not wait on an image to say what the app is.
function Handset() {
  return (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.6 3.5c.5-.2 1.1 0 1.4.5l1.7 3c.3.5.2 1.1-.2 1.5l-1.3 1.2c.9 1.9 2.4 3.4 4.3 4.3l1.2-1.3c.4-.4 1-.5 1.5-.2l3 1.7c.5.3.7.9.5 1.4l-.8 2c-.2.6-.8.9-1.4.8C10.6 17.4 6.6 13.4 5.3 6.5c-.1-.6.2-1.2.8-1.4l.5-1.6z"
        fill="#fff"
      />
    </svg>
  );
}

export default function Home() {
  return (
    <Marketing>
      <div className="mark"><Handset /></div>
      <h1 style={{ fontSize: 40 }}>Your phone number, on your phone.</h1>
      <p style={{ fontSize: 19, margin: "16px 0 8px" }}>
        EasyCall makes and takes calls on a real phone number, and texts from the
        same one. Calls can be recorded, and every call and message stays in one
        place.
      </p>

      <h2 style={{ fontSize: 22, margin: "38px 0 10px" }}>What it does</h2>
      <ul style={{ paddingLeft: 20, color: "var(--body)", lineHeight: 1.7 }}>
        <li>Call and answer on a number of your own, over the internet.</li>
        <li>Text from that same number, with the whole thread kept together.</li>
        <li>Record calls, and play them back later.</li>
      </ul>

      <h2 style={{ fontSize: 22, margin: "38px 0 10px" }}>Getting it</h2>
      <p>
        EasyCall is an iPhone app. It is in review with the App Store — this page
        will carry the download link the moment it is approved.
      </p>
    </Marketing>
  );
}
