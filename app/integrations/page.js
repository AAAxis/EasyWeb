"use client";

import Dashboard from "../components/Dashboard";
import Account from "../components/Account";

export default function Page() {
  return <Dashboard here="/integrations">{(props) => <Account {...props} />}</Dashboard>;
}
