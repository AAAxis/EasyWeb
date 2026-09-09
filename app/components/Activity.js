"use client";

import Calls from "../dashboard/screens/Calls";
import Sms from "../dashboard/screens/Sms";

/**
 * Calls and texts share the Activity shell but keep distinct addresses. The
 * profile menu moves between them, so the content needs no second navigation
 * bar of its own.
 */
export default function Activity({ initial = "calls", ...props }) {
  return initial === "calls" ? <Calls {...props} /> : <Sms {...props} />;
}
