// The narrow column the written pages live in. The dashboard does not use it:
// a table wants the whole window, and prose does not.
export default function Marketing({ children }) {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "72px 24px 96px" }}>
      {children}
      <nav>
        <a href="/">Dashboard</a>
        <a href="/about">About</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="mailto:support@chatkit.cc">Support</a>
      </nav>
    </main>
  );
}
