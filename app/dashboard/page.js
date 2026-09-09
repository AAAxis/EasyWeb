"use client";

// /dashboard is the same screen as /, because that is what people type. The
// tab it lights up is the Dashboard tab, not a sixth one.
import Dashboard from "../components/Dashboard";
import Console from "../components/Console";

export default function Page() {
  return <Dashboard here="/">{(props) => <Console {...props} />}</Dashboard>;
}
