"use client";

import Dashboard from "../components/Dashboard";
import Activity from "../components/Activity";

export default function Page() {
  return <Dashboard here="/calls">{(props) => <Activity initial="calls" {...props} />}</Dashboard>;
}
