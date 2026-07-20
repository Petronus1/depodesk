// ============================================================
// DepoDesk — Session History / Audit Trail (attorney side)
// ============================================================
// Modal listing every session the attorney has hosted. Selecting
// one shows the full audit record — participant roster and the
// timestamped event chronology — with a court-ready PDF export
// (rendered to a print window; save as PDF from the print dialog).
// ============================================================

import { useState, useEffect } from "react";
import { getSessionHistory, getSessionAudit } from "./depodesk-supabase";

const GOLD   = "#C9A84C";
const NAVY   = "#0F1B2D";
const DARK   = "#0A1628";
const BORDER = "#1E3254";
const MUTED  = "#7A93B8";
const DIM    = "#4A6080";
const GREEN  = "#4CAF82";

const EVENT_LABELS = {
  session_started:      { icon: "▶", color: GREEN,     label: "Session started" },
  session_ended:        { icon: "■", color: "#F87171", label: "Session ended" },
  exhibit_shared:       { icon: "→", color: GOLD,      label: "Exhibit presented" },
  exhibit_marked:       { icon: "✓", color: GREEN,     label: "Marked into record" },
  exhibit_cleared:      { icon: "✕", color: MUTED,     label: "Presentation cleared" },
  control_transferred:  { icon: "⇄", color: "#C084FC", label: "Control transferred" },
  participant_joined:   { icon: "↓", color: MUTED,     label: "Requested to join" },
  participant_admitted: { icon: "＋", color: "#7EB3E8", label: "Admitted" },
  participant_declined: { icon: "⊘", color: "#F87171", label: "Declined" },
  participant_removed:  { icon: "－", color: "#F87171", label: "Removed" },
  role_changed:         { icon: "✎", color: "#C084FC", label: "Role changed" },
  page_direct:          { icon: "⬆", color: GOLD,      label: "Directed witness to page" },
  witness_markup_started: { icon: "✏", color: "#C07EE8", label: "Witness markup requested" },
  witness_marked_exhibit: { icon: "✏", color: "#C07EE8", label: "Witness marked exhibit" },
};

const ROLE_LABELS = {
  witness: "Witness",
  opposing_counsel: "Opposing Counsel",
  court_reporter: "Court Reporter",
};

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDateTime(ts) {
  return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Build a monochrome, court-friendly report and hand it to the
// browser's print dialog (user saves as PDF from there).
function exportPdf(session, events, participants) {
  const caseName = session.cases?.name || "Deposition";
  const caseNum  = session.cases?.number || "";
  const rows = events.map(ev => {
    const cfg = EVENT_LABELS[ev.event_type] || { label: ev.event_type };
    const what = [
      cfg.label,
      ev.exhibit_num ? `Exhibit ${ev.exhibit_num}` : null,
      ev.exhibit_name ? `“${esc(ev.exhibit_name)}”` : null,
    ].filter(Boolean).join(" — ");
    const who = [ev.actor_name, ev.actor_role ? `(${esc(ev.actor_role).replace("_", " ")})` : null]
      .filter(Boolean).join(" ");
    return `<tr>
      <td class="t">${esc(fmtTime(ev.created_at))}</td>
      <td>${what}${ev.notes ? `<div class="n">${esc(ev.notes)}</div>` : ""}</td>
      <td>${esc(who)}</td>
    </tr>`;
  }).join("");

  const roster = participants.map(p => `<tr>
    <td>${esc(p.name)}</td>
    <td>${esc(ROLE_LABELS[p.role] || p.role)}</td>
    <td>${esc(p.email || "—")}</td>
    <td>${esc(p.status)}</td>
    <td class="t">${esc(fmtDateTime(p.joined_at))}</td>
  </tr>`).join("");

  const html = `<!doctype html><html><head><title>Session Audit — ${esc(caseName)}</title>
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; color: #111; margin: 48px; }
    h1 { font-size: 20px; margin: 0 0 2px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin: 28px 0 8px; border-bottom: 1px solid #999; padding-bottom: 4px; }
    .sub { color: #444; font-size: 13px; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; border-bottom: 1px solid #333; padding: 4px 8px 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { border-bottom: 1px solid #ddd; padding: 5px 8px 5px 0; vertical-align: top; }
    .t { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .n { color: #555; font-style: italic; }
    .meta td { border: none; padding: 2px 16px 2px 0; }
    .foot { margin-top: 36px; font-size: 10px; color: #777; }
    @media print { body { margin: 24px; } }
  </style></head><body>
    <h1>Deposition Session Audit Trail</h1>
    <div class="sub">${esc(caseName)}${caseNum ? " · " + esc(caseNum) : ""}</div>
    <h2>Session</h2>
    <table class="meta">
      <tr><td>Started</td><td>${esc(fmtDateTime(session.started_at))}</td></tr>
      ${session.ended_at ? `<tr><td>Ended</td><td>${esc(fmtDateTime(session.ended_at))}</td></tr>` : ""}
      <tr><td>Session PIN</td><td>${esc(session.pin || "—")}</td></tr>
      <tr><td>Status</td><td>${session.is_active ? "Active" : "Ended"}</td></tr>
    </table>
    <h2>Participants (${participants.length})</h2>
    <table><tr><th>Name</th><th>Role</th><th>Email</th><th>Status</th><th>Joined</th></tr>${roster || "<tr><td colspan=5>None</td></tr>"}</table>
    <h2>Chronology (${events.length} events)</h2>
    <table><tr><th>Time</th><th>Event</th><th>By</th></tr>${rows || "<tr><td colspan=3>No events recorded</td></tr>"}</table>
    <div class="foot">Generated by DepoDesk on ${esc(new Date().toLocaleString())}</div>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Pop-up blocked — allow pop-ups to export the audit trail."); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

export default function SessionHistory({ onClose }) {
  const [sessions, setSessions]   = useState(null);
  const [selected, setSelected]   = useState(null);
  const [audit, setAudit]         = useState(null);
  const [error, setError]         = useState(null);

  useEffect(() => {
    getSessionHistory().then(setSessions).catch(err => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selected) { setAudit(null); return; }
    setAudit(null);
    getSessionAudit(selected.id).then(setAudit).catch(err => setError(err.message));
  }, [selected?.id]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}>
      <div style={{ background: NAVY, border: `1px solid ${BORDER}`, borderRadius: 10, width: 780, maxWidth: "94vw", height: "80vh", boxShadow: "0 20px 60px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#E8EDF5" }}>Session History</div>
            <div style={{ fontSize: 11, color: DIM, marginTop: 1 }}>Audit trail of every deposition session you have hosted</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {selected && audit && (
              <button onClick={() => exportPdf(selected, audit.events, audit.participants)} style={{ background: GOLD, color: NAVY, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                ⇩ Export PDF
              </button>
            )}
            <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>Close</button>
          </div>
        </div>

        {error && <div style={{ padding: "10px 20px", fontSize: 12, color: "#F87171" }}>{error}</div>}

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* Session list */}
          <div style={{ width: 250, borderRight: `1px solid ${BORDER}`, overflowY: "auto", flexShrink: 0, background: "#0C1624" }}>
            {sessions === null && <div style={{ padding: 16, fontSize: 12, color: DIM }}>Loading…</div>}
            {sessions?.length === 0 && <div style={{ padding: 16, fontSize: 12, color: DIM }}>No sessions yet.</div>}
            {sessions?.map(s => (
              <div key={s.id} onClick={() => setSelected(s)} style={{
                padding: "10px 14px", borderBottom: "1px solid #1A2D47", cursor: "pointer",
                background: selected?.id === s.id ? "#162540" : "transparent",
                borderLeft: selected?.id === s.id ? `3px solid ${GOLD}` : "3px solid transparent",
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#C8D6E8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.cases?.name || "Deposition"}
                </div>
                <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>{fmtDateTime(s.started_at)}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 3, alignItems: "center" }}>
                  {s.is_active
                    ? <span style={{ fontSize: 9, background: "#0D2D1A", color: GREEN, borderRadius: 3, padding: "1px 5px", fontWeight: 600 }}>LIVE</span>
                    : <span style={{ fontSize: 9, background: "#1A1A2E", color: MUTED, borderRadius: 3, padding: "1px 5px" }}>ENDED</span>}
                  {s.pin && <span style={{ fontSize: 9, color: DIM, fontFamily: "monospace" }}>PIN {s.pin}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Audit detail */}
          <div style={{ flex: 1, overflowY: "auto", padding: selected ? "16px 20px" : 0 }}>
            {!selected && (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: DIM }}>
                Select a session to view its audit trail
              </div>
            )}
            {selected && !audit && !error && <div style={{ fontSize: 12, color: DIM }}>Loading audit record…</div>}
            {selected && audit && (
              <>
                {/* Roster */}
                <div style={{ fontSize: 10, color: DIM, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 8 }}>
                  Participants · {audit.participants.length}
                </div>
                {audit.participants.length === 0 && <div style={{ fontSize: 12, color: "#2A3F58", marginBottom: 14 }}>No participants joined.</div>}
                {audit.participants.map(p => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #1A2D47", fontSize: 12 }}>
                    <span style={{ color: "#C8D6E8", fontWeight: 600 }}>{p.name}</span>
                    <span style={{ color: DIM, fontSize: 11 }}>{ROLE_LABELS[p.role] || p.role}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: p.status === "approved" ? GREEN : p.status === "rejected" ? "#F87171" : GOLD }}>{p.status}</span>
                    <span style={{ fontSize: 10, color: "#2A3F58" }}>{fmtTime(p.joined_at)}</span>
                  </div>
                ))}

                {/* Chronology */}
                <div style={{ fontSize: 10, color: DIM, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.7px", margin: "18px 0 8px" }}>
                  Chronology · {audit.events.length} events
                </div>
                {audit.events.length === 0 && <div style={{ fontSize: 12, color: "#2A3F58" }}>No events recorded for this session.</div>}
                {audit.events.map(ev => {
                  const cfg = EVENT_LABELS[ev.event_type] || { icon: "•", color: MUTED, label: ev.event_type };
                  return (
                    <div key={ev.id} style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid #1A2D47", alignItems: "flex-start" }}>
                      <span style={{ fontSize: 11, color: DIM, fontFamily: "monospace", width: 68, flexShrink: 0, paddingTop: 1 }}>{fmtTime(ev.created_at)}</span>
                      <span style={{ color: cfg.color, fontSize: 12, width: 16, flexShrink: 0, textAlign: "center" }}>{cfg.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 12, color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
                        {(ev.exhibit_num || ev.exhibit_name) && (
                          <span style={{ fontSize: 12, color: MUTED }}>
                            {" — "}{ev.exhibit_num ? `Exhibit ${ev.exhibit_num} ` : ""}{ev.exhibit_name ? `“${ev.exhibit_name}”` : ""}
                          </span>
                        )}
                        {ev.actor_name && <div style={{ fontSize: 10, color: DIM, marginTop: 1 }}>{ev.actor_name}{ev.actor_role ? ` (${ev.actor_role.replace("_", " ")})` : ""}</div>}
                        {ev.notes && <div style={{ fontSize: 10, color: DIM, marginTop: 1, fontStyle: "italic" }}>{ev.notes}</div>}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
