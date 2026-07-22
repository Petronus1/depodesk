// ============================================================
// DepoDesk — Session Panel (attorney side)
// ============================================================
// Shown when an active deposition session is running.
// Displays:
//   - PIN to share with participants
//   - Live participants list with role assignment
//   - Control transfer button
//   - End session button
//
// USAGE in depo-exhibit-app.jsx:
//   import SessionPanel from "./depodesk-session-panel"
//   {activeSession && (
//     <SessionPanel
//       session={activeSession}
//       onEndSession={handleEndSession}
//       onTransferControl={handleTransferControl}
//       onUpdateRole={handleUpdateRole}
//     />
//   )}
// ============================================================

import { useState, useEffect } from "react";
import { supabase } from "./depodesk-supabase";

const GOLD   = "#C9A84C";
const NAVY   = "#0F1B2D";
const DARK   = "#0A1628";
const BORDER = "#1E3254";
const MUTED  = "#7A93B8";
const DIM    = "#4A6080";
const GREEN  = "#4CAF82";

const ROLE_LABELS = {
  witness:          { label: "Witness",          color: "#7EB3E8", bg: "#1E3A5F" },
  opposing_counsel: { label: "Opposing Counsel", color: "#C07EE8", bg: "#2D1E3A" },
  court_reporter:   { label: "Court Reporter",   color: "#7EE8A0", bg: "#1E3A2D" },
};

const ROLES = ["witness", "opposing_counsel", "court_reporter"];

export default function SessionPanel({ session, participants: participantsProp, onEndSession, onTransferControl, onUpdateRole }) {
  const [localParticipants, setLocalParticipants] = useState([]);
  // Prefer the app's polled list (kept fresh every 8s); the local
  // realtime list only works if DB replication is enabled.
  const participants = participantsProp ?? localParticipants;
  const setParticipants = setLocalParticipants;
  const [pinCopied, setPinCopied]       = useState(false);
  const [linkCopied, setLinkCopied]     = useState(false);
  const [isMinimized, setIsMinimized]   = useState(false);

  const joinUrl = `${window.location.origin}/join?pin=${session.pin}`;
  const hasControl = session.controller_role === "host";

  useEffect(() => {
    if (!session?.id) return;

    // Load existing participants
    supabase.from("participants").select("*").eq("session_id", session.id).eq("is_active", true)
      .then(({ data }) => { if (data) setParticipants(data); });

    // Subscribe to new participants joining
    const channel = supabase.channel(`participants:${session.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "participants",
        filter: `session_id=eq.${session.id}`,
      }, ({ new: participant }) => {
        setParticipants(prev => [...prev, participant]);
      })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "participants",
        filter: `session_id=eq.${session.id}`,
      }, ({ new: participant }) => {
        setParticipants(prev => prev.map(p => p.id === participant.id ? participant : p));
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session?.id]);

  async function copyPin() {
    await navigator.clipboard?.writeText(session.pin);
    setPinCopied(true);
    setTimeout(() => setPinCopied(false), 2000);
  }

  async function copyLink() {
    await navigator.clipboard?.writeText(joinUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function updateRole(participantId, newRole) {
    await supabase.from("participants").update({ role: newRole }).eq("id", participantId);
    setParticipants(prev => prev.map(p => p.id === participantId ? { ...p, role: newRole } : p));
    onUpdateRole?.(participantId, newRole);
  }

  async function removeParticipant(participantId) {
    await supabase.from("participants").update({ is_active: false }).eq("id", participantId);
    setParticipants(prev => prev.filter(p => p.id !== participantId));
  }

  return (
    <div style={{
      position: "fixed", right: 16, bottom: 16, top: "auto",
      width: isMinimized ? "auto" : 300,
      maxHeight: "70vh", display: "flex", flexDirection: "column",
      background: NAVY, border: `1px solid ${BORDER}`,
      borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      zIndex: 200, overflow: "hidden",
    }}>

      {/* Panel header */}
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, animation: "pulse 1.5s infinite" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#E8EDF5" }}>Live Session</span>
          <span style={{ fontSize: 10, background: "#0D2D1A", color: GREEN, borderRadius: 3, padding: "1px 6px", fontWeight: 600 }}>
            {participants.length} connected
          </span>
        </div>
        <button onClick={() => setIsMinimized(v => !v)} style={{ background: "transparent", border: "none", color: DIM, cursor: "pointer", fontSize: 14, padding: "0 2px" }}>
          {isMinimized ? "▲" : "▼"}
        </button>
      </div>

      {!isMinimized && (
        <div style={{ overflowY: "auto", flex: 1 }}>
          {/* Which deposition this session is for */}
          {(session.witnessName || session.caseName) && (
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${BORDER}` }}>
              {session.witnessName && (
                <div style={{ fontSize: 12, color: "#E8EDF5" }}>
                  Deposition of <span style={{ fontWeight: 700, color: GOLD }}>{session.witnessName}</span>
                </div>
              )}
              {session.caseName && (
                <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>{session.caseName}</div>
              )}
            </div>
          )}

          {/* PIN */}
          <div style={{ padding: "14px 14px 10px" }}>
            <div style={{ fontSize: 10, color: DIM, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Session PIN</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                flex: 1, background: DARK, border: `1px solid ${BORDER}`,
                borderRadius: 6, padding: "8px 12px",
                fontFamily: "monospace", fontSize: 22, fontWeight: 900,
                color: GOLD, letterSpacing: "6px", textAlign: "center",
              }}>{session.pin}</div>
              <button onClick={copyPin} style={{
                background: pinCopied ? "#0D2D1A" : GOLD,
                border: pinCopied ? `1px solid #2A5C3A` : "none",
                color: pinCopied ? GREEN : NAVY,
                borderRadius: 6, padding: "8px 10px", fontSize: 11,
                fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}>{pinCopied ? "✓" : "Copy"}</button>
            </div>
            <button onClick={copyLink} style={{
              width: "100%", marginTop: 8,
              background: "transparent", border: `1px solid ${BORDER}`,
              color: linkCopied ? GREEN : MUTED,
              borderRadius: 6, padding: "6px", fontSize: 11,
              cursor: "pointer", fontFamily: "inherit",
            }}>{linkCopied ? "✓ Link copied" : "Copy join link"}</button>
          </div>

          {/* Control status */}
          <div style={{ padding: "0 14px 10px" }}>
            <div style={{ fontSize: 10, color: DIM, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Exhibit Control</div>
            <div style={{
              padding: "8px 10px", borderRadius: 6,
              background: hasControl ? "#0D2D1A" : "#2D1E3A",
              border: `1px solid ${hasControl ? "#2A5C3A" : "#5C3A7A"}`,
              fontSize: 12, color: hasControl ? GREEN : "#C07EE8",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span>{hasControl ? "You have control" : "Opposing counsel has control"}</span>
              {!hasControl && (
                <button onClick={onTransferControl} style={{
                  background: GOLD, color: NAVY, border: "none",
                  borderRadius: 4, padding: "3px 8px", fontSize: 10,
                  fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                }}>Reclaim</button>
              )}
            </div>
            {hasControl && participants.some(p => p.role === "opposing_counsel") && (
              <button onClick={onTransferControl} style={{
                width: "100%", marginTop: 6,
                background: "transparent", border: `1px solid #5C3A7A`,
                color: "#C07EE8", borderRadius: 6, padding: "6px",
                fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              }}>Transfer control to opposing counsel</button>
            )}
          </div>

          {/* Participants */}
          <div style={{ padding: "0 14px 10px" }}>
            <div style={{ fontSize: 10, color: DIM, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
              Participants ({participants.length})
            </div>
            {participants.length === 0 && (
              <div style={{ fontSize: 12, color: DIM, textAlign: "center", padding: "10px 0" }}>
                No one has joined yet
              </div>
            )}
            {participants.map(p => {
              const rc = ROLE_LABELS[p.role] || ROLE_LABELS.witness;
              return (
                <div key={p.id} style={{ marginBottom: 8, padding: "8px 10px", background: DARK, borderRadius: 6, border: `1px solid ${BORDER}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#E8EDF5" }}>{p.name}</div>
                    <button onClick={() => removeParticipant(p.id)} style={{ background: "transparent", border: "none", color: DIM, cursor: "pointer", fontSize: 12, padding: 0 }}>×</button>
                  </div>
                  {p.email && <div style={{ fontSize: 10, color: DIM, marginBottom: 6 }}>{p.email}</div>}
                  {/* Role selector */}
                  <select
                    value={p.role}
                    onChange={e => updateRole(p.id, e.target.value)}
                    style={{
                      width: "100%", background: rc.bg, border: `1px solid ${BORDER}`,
                      borderRadius: 4, padding: "4px 8px", fontSize: 10,
                      color: rc.color, fontWeight: 600, cursor: "pointer",
                      fontFamily: "inherit", outline: "none",
                    }}
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r} style={{ background: NAVY, color: "#E8EDF5" }}>
                        {ROLE_LABELS[r].label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          {/* End session */}
          <div style={{ padding: "0 14px 14px" }}>
            <button onClick={() => { if (confirm("End this deposition session? All participants will be disconnected.")) onEndSession(); }}
              style={{
                width: "100%", background: "transparent",
                border: "1px solid #5C1A1A", color: "#F87171",
                borderRadius: 6, padding: "7px",
                fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              }}>
              End Session
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}
