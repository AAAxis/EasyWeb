"use client";

// Kept as an address for old links, but the signed-in home is now Activity.
import Dashboard from "../components/Dashboard";
import Activity from "../components/Activity";

export default function Page() {
  return <Dashboard here="/calls">{(props) => <Activity initial="calls" {...props} />}</Dashboard>;
}
