"use client";

// Kept as an address — links and bookmarks point here — but there is no phone
// screen any more: the keypad is the call button, on whichever screen you are.
import Dashboard from "../components/Dashboard";
import Activity from "../components/Activity";

export default function Page() {
  return <Dashboard here="/calls">{(props) => <Activity initial="calls" {...props} />}</Dashboard>;
}
