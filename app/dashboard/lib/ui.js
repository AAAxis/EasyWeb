"use client";

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

export function Table({ cols, rows, empty = "Nothing yet." }) {
  if (!rows) return <Skeleton />;
  if (rows.length === 0) return <div style={{ ...card, color: C.muted, fontSize: 13.5 }}>{empty}</div>;
  const cell = { padding: "10px 12px", fontSize: 13, borderBottom: `1px solid ${C.border}`, textAlign: "left" };
  return (
    <div style={{ ...card, padding: 0, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
        <thead>
          <tr>
            {cols.map(([label]) => (
              <th key={label} style={{ ...cell, color: C.faint, fontWeight: 600, fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i}>
              {cols.map(([label, render]) => (
                <td key={label} style={{ ...cell, color: C.text }}>{render(row)}</td>
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
