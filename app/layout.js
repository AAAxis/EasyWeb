import { Inter } from "next/font/google";

export const metadata = {
  title: "EasyCall — your phone number, on your phone",
  description:
    "Call and text from a real phone number on your iPhone. Recordings, and every conversation in one place.",
};

// Loaded through next/font so it is self-hosted and swaps without shifting the
// layout — a webfont that arrives late is what makes a landing page feel cheap.
const inter = Inter({ subsets: ["latin"], display: "swap", weight: ["400", "500", "600", "700", "800"] });

// One stylesheet, inline. This is a handful of pages; a CSS pipeline would be
// more machinery than the site is.
//
// Light only, deliberately: the marketing surface is a designed thing with its
// own contrast, and a dark override would invert artwork it was never checked
// against.
const css = `
  :root {
    --ink: #0B1220; --body: #4A5261; --faint: #8A93A3;
    --line: #E6E9EF; --bg: #FFFFFF; --wash: #F5F7FB;
    --tint: #2F6BFF; --tint-dark: #1E4FD8;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--bg); color: var(--ink); -webkit-font-smoothing: antialiased; }
  h1, h2, h3 { margin: 0; letter-spacing: -0.025em; font-weight: 800; line-height: 1.08; }
  p { margin: 0; color: var(--body); line-height: 1.6; }
  a { color: inherit; text-decoration: none; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    background: var(--ink); color: #fff; border: none; border-radius: 999px;
    padding: 14px 26px; font-size: 15px; font-weight: 600; cursor: pointer;
    transition: transform .12s ease, background .12s ease;
  }
  .btn:hover { background: #000; transform: translateY(-1px); }
  .btn-tint { background: var(--tint); }
  .btn-tint:hover { background: var(--tint-dark); }
  nav.top { border-bottom: 1px solid var(--line); background: rgba(255,255,255,0.86); backdrop-filter: saturate(180%) blur(10px); position: sticky; top: 0; z-index: 20; }
  nav.top .wrap { display: flex; align-items: center; gap: 26px; height: 68px; }
  nav.top a.link { font-size: 14.5px; color: var(--body); font-weight: 500; }
  nav.top a.link:hover { color: var(--ink); }
  footer { border-top: 1px solid var(--line); margin-top: 96px; padding: 40px 0 64px; }
  footer .wrap { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; }
  footer a { font-size: 14px; color: var(--faint); }
  footer a:hover { color: var(--ink); }
  @media (max-width: 720px) {
    nav.top .wrap { gap: 16px; }
    .hide-sm { display: none; }
  }
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.className}>
      <body>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        {children}
      </body>
    </html>
  );
}
