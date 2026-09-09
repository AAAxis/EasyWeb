"use client";

import Dashboard from "../components/Dashboard";
import Activity from "../components/Activity";

export default function Page() {
  return <Dashboard here="/sms">{(props) => <Activity initial="sms" {...props} />}</Dashboard>;
}
