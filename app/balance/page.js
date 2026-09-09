"use client";

import Dashboard from "../components/Dashboard";
import Balance from "../dashboard/screens/Balance";

export default function Page() {
  return <Dashboard here="/balance">{(props) => <Balance {...props} />}</Dashboard>;
}
