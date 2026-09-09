"use client";

import Dashboard from "../components/Dashboard";
import Sms from "../dashboard/screens/Sms";

export default function Page() {
  return <Dashboard here="/sms">{(props) => <Sms {...props} />}</Dashboard>;
}
