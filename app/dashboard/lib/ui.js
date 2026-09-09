"use client";

import { useEffect } from "react";

// The small kit this dashboard is built from. Five tabs do not need a design
// system; they need consistent spacing and one table.

export const C = {
  bg: "#F7F8FA",
  surface: "#FFFFFF",
  border: "#E4E7EC",
  text: "#0B1220",
  muted: "#5B6472",
  faint: "#98A1AE",
  tint: "#2F6BFF",
  good: "#0CA678",
  bad: "#DC2626",
};

export const card = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  padding: 16,
};

/** A date a person reads, not an ISO string. */
export const when = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

/** Seconds as m:ss, because 143 means nothing at a glance. */
export const dur = (seconds) => {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}`;
};

/** `onRow` makes rows clickable; without it the table is read-only as before. */
export function Table({ cols, rows, empty = "Nothing yet.", onRow, className }) {
  if (!rows) return <Skeleton />;
  if (rows.length === 0) return <div style={{ ...card, color: C.muted, fontSize: 13.5 }}>{empty}</div>;
  const cell = { padding: "10px 12px", fontSize: 13, borderBottom: `1px solid ${C.border}`, textAlign: "left" };
  return (
    <div style={{ ...card, padding: 0, overflowX: "auto" }}>
      <table className={className} style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
        <thead>
          <tr>
            {cols.map(([label, , className]) => (
              <th key={label} className={className} style={{ ...cell, color: C.faint, fontWeight: 600, fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id ?? i}
              onClick={onRow ? () => onRow(row) : undefined}
              style={onRow ? { cursor: "pointer" } : undefined}
            >
              {cols.map(([label, render, className]) => (
                <td key={label} className={className} style={{ ...cell, color: C.text }}>{render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Skeleton({ rows = 5 }) {
  return (
    <div style={{ ...card }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ height: 14, borderRadius: 7, background: "#EDEFF3", marginBottom: 10, width: `${90 - i * 9}%` }} />
      ))}
    </div>
  );
}

// Paired background and ink, light enough to sit under a name without shouting.
const TINTS = [
  ["#E8EDFF", "#2A46C0"], ["#E5F5EA", "#1C7440"], ["#FDEAEE", "#AE2842"],
  ["#FFF1DE", "#8F5410"], ["#EEE8FD", "#5539B8"], ["#E1F3F8", "#12637A"],
];

/**
 * Someone's initials in a circle.
 *
 * The colour is hashed from the name rather than picked at random, so a person
 * keeps the same one between renders and across screens — an avatar that
 * changes colour on every load is decoration, not identity. A bare phone number
 * has no initials worth showing, and a silhouette admits we do not know who it
 * is more honestly than two arbitrary digits would.
 */
export function Avatar({ name, size = 34 }) {
  const label = String(name ?? "").trim();
  const named = /[\p{L}]/u.test(label);
  const key = label || "?";
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const [bg, ink] = named ? TINTS[hash % TINTS.length] : ["#EDEFF3", "#98A0AE"];

  const initials = named
    ? label.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()
    : null;

  return (
    <span
      aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: bg, color: ink, display: "inline-flex",
        alignItems: "center", justifyContent: "center",
        fontSize: Math.round(size * 0.4), fontWeight: 700, letterSpacing: "0.01em",
        userSelect: "none",
      }}
    >
      {initials ?? (
        <svg width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z" />
        </svg>
      )}
    </span>
  );
}

export function Note({ tone = "muted", children }) {
  if (!children) return null;
  const colour = tone === "bad" ? C.bad : tone === "good" ? C.good : C.muted;
  return <div style={{ fontSize: 13, color: colour, marginTop: 10 }}>{children}</div>;
}

export function Button({ children, onClick, disabled, tone = "tint" }) {
  const bg = disabled ? "#E4E7EC" : tone === "bad" ? C.bad : C.tint;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 600,
        background: bg, color: disabled ? C.faint : "#fff", cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

export const input = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 13.5,
  border: `1px solid ${C.border}`, borderRadius: 10, outline: "none", color: C.text,
  background: C.surface,
};

/**
 * A dialog over the page. Closes on the backdrop and on Escape, because both
 * are what people try before looking for the X.
 */
export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(11,18,32,0.38)", zIndex: 50 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "fixed", zIndex: 51, top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: 460, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 64px)", overflowY: "auto",
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
          boxShadow: "0 24px 60px rgba(11,18,32,0.22)", padding: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1, fontSize: 15.5, fontWeight: 700, color: C.text }}>{title}</div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              border: `1px solid ${C.border}`, background: "#fff", color: C.muted, borderRadius: 9,
              width: 28, height: 28, cursor: "pointer", fontSize: 15, lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
