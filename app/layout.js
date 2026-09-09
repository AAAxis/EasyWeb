export const metadata = {
  title: "EasyCall — your phone number, on your phone",
  description:
    "Call and text from a real phone number on your iPhone. Recordings, and every conversation in one place.",
};

// One stylesheet, inline, because this is four pages and a CSS pipeline would
// be more machinery than the site is.
const css = `
  :root { color-scheme: light dark; --ink: #0b1220; --soft: #5b6472; --line: #e4e7ec; --bg: #ffffff; --tint: #2f6bff; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #f4f6fa; --soft: #9aa3b2; --line: #232833; --bg: #0b0e14; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  h1 { font-size: 40px; line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 12px; }
  h2 { font-size: 20px; letter-spacing: -0.01em; margin: 40px 0 10px; }
  p, li { color: var(--soft); }
  a { color: var(--tint); }
  .lede { font-size: 19px; color: var(--soft); margin: 0 0 32px; }
  .mark { width: 76px; height: 76px; border-radius: 18px; background: linear-gradient(160deg, #4f8cff, #2f6bff); display: grid; place-items: center; margin-bottom: 26px; box-shadow: 0 10px 30px rgba(47,107,255,0.25); }
  nav { border-top: 1px solid var(--line); margin-top: 56px; padding-top: 20px; font-size: 14px; }
  nav a { margin-right: 18px; }
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        {children}
      </body>
    </html>
  );
}
