"use client";

import Dashboard from "../components/Dashboard";
import Recordings from "../dashboard/screens/Recordings";

export default function Page() {
  return <Dashboard here="/recordings">{(props) => <Recordings {...props} />}</Dashboard>;
}
