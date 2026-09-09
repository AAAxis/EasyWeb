// The bar and the footer every page wears. The dashboard skips them: once you
// are signed in, marketing navigation is in the way.
export function Mark({ size = 34 }) {
  // The app's own icon, not a drawing of it. One file, used by the bar, the
  // footer, the hero and the dashboard header, so all four cannot drift.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="EasyCall"
      width={size}
      height={size}
      style={{
        width: size, height: size, borderRadius: size * 0.26, flexShrink: 0,
        display: "block", boxShadow: "0 6px 18px rgba(47,107,255,0.28)",
      }}
    />
  );
}

export function TopBar() {
  return (
    <nav className="top">
      <div className="wrap">
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Mark />
          <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.02em" }}>EasyCall</span>
        </a>
        <span style={{ flex: 1 }} />
        <a className="link hide-sm" href="/about">Product</a>
        <a className="link hide-sm" href="/privacy">Privacy</a>
        <a className="link" href="mailto:support@chatkit.cc">Support</a>
      </div>
    </nav>
  );
}

export function Footer() {
  return (
    <footer>
      <div className="wrap">
        <Mark size={26} />
        <span style={{ fontSize: 14, color: "var(--faint)" }}>© {new Date().getFullYear()} EasyCall</span>
        <span style={{ flex: 1 }} />
        <a href="/about">Product</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="mailto:support@chatkit.cc">Support</a>
      </div>
    </footer>
  );
}
