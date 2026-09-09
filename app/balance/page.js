"use client";

// /balance kept its address — links and bookmarks point at it — but it is no
// longer a tab of its own: it lands on the same screen, where the float now
// sits above the things that spend it.
import Dashboard from "../components/Dashboard";
import Account from "../components/Account";

export default function Page() {
  return <Dashboard here="/integrations">{(props) => <Account {...props} />}</Dashboard>;
}
