"use client";

import Dashboard from "../components/Dashboard";
import Integrations from "../dashboard/screens/Integrations";

export default function Page() {
  return <Dashboard here="/integrations">{(props) => <Integrations {...props} />}</Dashboard>;
}
