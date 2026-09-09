import { Footer, TopBar } from "./Chrome";

// The narrow column the written pages live in, between the same bar and footer
// the landing wears. The dashboard uses neither: a table wants the window, and
// marketing navigation is in the way once you are signed in.
export default function Marketing({ children }) {
  return (
    <>
      <TopBar />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px 24px" }}>
        {children}
      </main>
      <Footer />
    </>
  );
}
