"use client";

import Dashboard from "../components/Dashboard";
import Calls from "../dashboard/screens/Calls";

export default function Page() {
  return <Dashboard here="/calls">{(props) => <Calls {...props} />}</Dashboard>;
}
