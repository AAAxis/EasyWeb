// The bar and the footer every page wears. The dashboard skips them: once you
// are signed in, marketing navigation is in the way.
export function Mark({ size = 34 }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: size * 0.26, flexShrink: 0,
        background: "linear-gradient(160deg, #4f8cff, #2f6bff)",
        display: "grid", placeItems: "center",
        boxShadow: "0 6px 18px rgba(47,107,255,0.28)",
      }}
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M6.6 3.5c.5-.2 1.1 0 1.4.5l1.7 3c.3.5.2 1.1-.2 1.5l-1.3 1.2c.9 1.9 2.4 3.4 4.3 4.3l1.2-1.3c.4-.4 1-.5 1.5-.2l3 1.7c.5.3.7.9.5 1.4l-.8 2c-.2.6-.8.9-1.4.8C10.6 17.4 6.6 13.4 5.3 6.5c-.1-.6.2-1.2.8-1.4l.5-1.6z"
          fill="#fff"
        />
      </svg>
    </span>
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
