"use client";

import Dashboard from "../components/Dashboard";
import Phone from "../dashboard/screens/Phone";

export default function Page() {
  return <Dashboard here="/phone">{(props) => <Phone {...props} />}</Dashboard>;
}
