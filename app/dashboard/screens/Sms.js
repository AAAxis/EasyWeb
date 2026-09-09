"use client";

import { useEffect, useRef, useState } from "react";
import { Button, C, Skeleton, card, input, when } from "../lib/ui";

// Threads on the left, the conversation on the right. The same shape as every
// messaging app, because that is the shape people already know.
export default function Sms({ api, onError }) {
  const [threads, setThreads] = useState(null);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const openId = useRef(null);

  useEffect(() => {
    api("/conversations?limit=50")
      .then((b) => setThreads((b.conversations ?? []).filter((c) => c.channel !== "whatsapp")))
      .catch((e) => { setThreads([]); onError(e.message); });
  }, [api, onError]);

  const open = async (thread) => {
    openId.current = thread.id;
    setActive(thread);
    setMessages(null);
    try {
      const body = await api(`/conversations/${thread.id}/messages?limit=60`);
      if (openId.current !== thread.id) return; // they moved on while it loaded
      setMessages((body.messages ?? []).slice().reverse());
      api(`/conversations/${thread.id}/read`, { method: "POST" }).catch(() => {});
    } catch (e) {
      onError(e.message);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !active || sending) return;
    setSending(true);
    try {
      await api("/messages/sms", {
        method: "POST",
        body: JSON.stringify({ conversation_id: active.id, body }),
      });
      setMessages((current) => [...(current ?? []), {
        id: `tmp-${Date.now()}`, sender_type: "user", body, created_at: new Date().toISOString(),
      }]);
      setDraft("");
    } catch (e) {
      onError(e.message);
    } finally {
      setSending(false);
    }
  };

  if (!threads) return <Skeleton />;

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "stretch", minHeight: 460 }}>
      <div style={{ ...card, padding: 0, width: 280, flexShrink: 0, overflowY: "auto", maxHeight: 600 }}>
        {threads.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: C.muted }}>No texts yet.</div>
        ) : threads.map((thread) => (
          <div
            key={thread.id}
            onClick={() => open(thread)}
            style={{
              padding: "12px 14px", cursor: "pointer", borderBottom: "1px solid #F1F2F4",
              background: active?.id === thread.id ? "#EEF2FF" : "transparent",
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {thread.contact_name || thread.subject || "Unknown number"}
            </div>
            <div style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {thread.last_message_preview || "No messages"}
            </div>
          </div>
        ))}
      </div>

      <div style={{ ...card, flex: 1, minWidth: 0, display: "flex", flexDirection: "column", maxHeight: 600 }}>
        {!active ? (
          <div style={{ flex: 1, display: "grid", placeItems: "center", color: C.faint, fontSize: 14 }}>
            Pick a conversation
          </div>
        ) : (
          <>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text, paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>
              {active.contact_name || active.subject || "Unknown number"}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 2px", display: "flex", flexDirection: "column", gap: 8 }}>
              {!messages ? <Skeleton rows={3} /> : messages.length === 0 ? (
                <div style={{ color: C.faint, fontSize: 13 }}>No messages.</div>
              ) : messages.map((m) => {
                const mine = m.sender_type !== "contact";
                return (
                  <div
                    key={m.id}
                    dir="auto"
                    style={{
                      maxWidth: "72%", alignSelf: mine ? "flex-end" : "flex-start",
                      background: mine ? C.tint : "#F0F2F5", color: mine ? "#fff" : C.text,
                      borderRadius: 14, padding: "9px 13px", fontSize: 13.5, lineHeight: 1.45,
                      whiteSpace: "pre-wrap", overflowWrap: "anywhere",
                    }}
                  >
                    {m.body}
                    <div style={{ fontSize: 10, opacity: 0.65, marginTop: 3, textAlign: "end" }}>{when(m.created_at)}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
              <input
                style={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Write a text…"
              />
              <Button onClick={send} disabled={sending || !draft.trim()}>{sending ? "…" : "Send"}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
