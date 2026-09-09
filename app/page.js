"use client";

import Dashboard from "./components/Dashboard";
import Overview from "./dashboard/screens/Overview";

export default function Home() {
  return <Dashboard here="/">{(props) => <Overview {...props} />}</Dashboard>;
}
