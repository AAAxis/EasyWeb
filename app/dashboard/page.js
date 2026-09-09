"use client";

// Kept as an address — links and bookmarks point here — but not a tab. The
// keypad is the Call button, wherever you are.
import Dashboard from "../components/Dashboard";
import Overview from "../dashboard/screens/Overview";

export default function Page() {
  return <Dashboard here="/">{(props) => <Overview {...props} />}</Dashboard>;
}
