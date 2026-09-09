"use client";

import { useCallback } from "react";
import { VOIP_URL } from "./config";

/**
 * Every call to the VoIP service, with the token attached.
 *
 * No workspace id is sent: the server falls back to the caller's own workspace
 * when the header is absent, and picking one on the client is how a screen ends
 * up asking for somebody else's data.
 */
export function useVoip(token) {
  return useCallback(async (path, options = {}) => {
    const res = await fetch(`${VOIP_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Server said ${res.status}`);
    return body;
  }, [token]);
}
