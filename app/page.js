"use client";

import Dashboard from "./components/Dashboard";
import Console from "./components/Console";

export default function Home() {
  return <Dashboard here="/">{(props) => <Console {...props} />}</Dashboard>;
}
