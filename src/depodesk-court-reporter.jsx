// ============================================================
// DepoDesk — Court Reporter View (/court-reporter)
// ============================================================
// Shows a live timestamped log of:
//   - Every exhibit marked into the record
//   - Every exhibit shared by counsel
//   - Control transfers between parties
//   - Participants joining
// ============================================================

import { useState, useEffect, useRef } from "react";
import { supabase } from "./depodesk-supabase";

const GOLD   = "#C9A84C";
const NAVY   = "#0F1B2D";
const DARK   = "#060E1A";
const BORDER = "#1E3254";
const MUTED  = "#7A93B8";
const DIM    = "#4A6080";
const GREEN  = "#4CAF82";

const EVENT_CONFIG = {
  exhibit_marked:       { icon: "✓", color: GREEN,    label: "Marked into record" },
  exhibit_shared:       { icon: "→", color: GOLD,     label: "Presented to witness" },
  control_transferred:  { icon: "⇄", color: "#C084FC", label: "Control transferred" },
  participant_joined:   { icon: "↓", color: MUTED,    label: "Joined session" },
};

export default function CourtReporterView() {
  const [session, setSession]   = useState(null);
  const [events, setEvents]     = useState([]);
  const [status, setStatus]     = useState("connecting");
  const [search, setSearch]     = useState("");
  const logEndRef               = useRef(null);
  const unsubRef                = useRef(null);

  const sessionId     = sessionStorage.getItem("depo_session_id");
  const participantId = sessionStorage.getItem("depo_participant_id");
  const name          = sessionStorage.getItem("depo_participant_name");

  useEffect(() => {
    if (!sessionId) { setStatus("error"); return; }

    async function connect() {
      try {
        // Load session
        const { data: sess } = await supabase
          .from("sessions")
          .select("*, cases(name, number)")
          .eq("id", sessionId)
          .single();
        setSession(sess);

        // Load existing events
        const { data: existing } = await supabase
          .from("session_events")
          .select("*")
          .eq("session_id", sessionId)
          .order("created_at", { ascending: true });
        if (existing) setEvents(existing);

        setStatus("connected");

        // Subscribe to new events in realtime
        const channel = supabase.channel(`reporter:${sessionId}`)
          .on("broadcast", { event: "session_event" }, ({ payload }) => {
            setEvents(prev => [...prev, payload.event]);
          })
          .on("broadcast", { event: "session_ended" }, () => {
            setStatus("ended");
          })
          .subscribe();

        unsubRef.current = () => supabase.removeChannel(channel);
      } catch (err) {
        setStatus("error");
      }
    }

    connect();
    return () => unsubRef.current?.();
  }, [sessionId]);

  useEffect(() => {
    if (!participantId || status === "connecting" || status === "error" || status === "ended" || status === "removed") return;
    const viewMap = { witness: "/witness", opposing_counsel: "/opposing-counsel", court_reporter: "/court-reporter" };
    const interval = setInterval(async () => {
      const { data } = await supabase.from("participants").select("status, role").eq("id", participantId).single();
      if (!data) return;
      if (data.status === "rejected") { clearInterval(interval); setStatus("removed"); return; }
      if (data.role !== "court_reporter") { clearInterval(interval); window.location.href = viewMap[data.role]; }
    }, 5000);
    return () => clearInterval(interval);
  }, [status]);

    connect();
    return () => unsubRef.current?.();
  }, [sessionId]);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const filtered = events.filter(ev =>
    !search ||
    ev.exhibit_name?.toLowerCase().includes(search.toLowerCase()) ||
    ev.actor_name?.toLowerCase().includes(search.toLowerCase()) ||
    ev.event_type?.includes(search.toLowerCase())
  );

  const markedCount = events.filter(e => e.event_type === "exhibit_marked").length;

  if (status === "error" || !sessionId) {
    return (
      <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: DARK, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#E8EDF5" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: MUTED }}>Session not found</div>
          <a href="/join" style={{ display: "inline-block", marginTop: 16, color: GOLD, fontSize: 13 }}>← Back to Join</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: DARK, minHeight: "100vh", color: "#E8EDF5", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ background: NAVY, borderBottom: `1px solid ${BORDER}`, padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 24, height: 24, background: GOLD, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 12, color: NAVY }}>D</div>
          <span style={{ fontWeight: 700, fontSize: 14 }}>DepoDesk</span>
          <span style={{ fontSize: 12, color: DIM }}>— Court Reporter</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: DIM }}>{name}</span>
<span style={{ fontSize: 11, background: "#131F33", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "2px 8px", color: DIM, fontFamily: "monospace", letterSpacing: "2px" }}>
  PIN {sessionStorage.getItem("depo_pin")}
</span>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: status === "ended" ? "#F87171" : GREEN }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: status === "ended" ? "#F87171" : GREEN, animation: status !== "ended" ? "pulse 1.5s infinite" : "none" }} />
            {status === "ended" ? "Session ended" : "Live"}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ background: "#0C1624", borderBottom: `1px solid ${BORDER}`, padding: "10px 20px", display: "flex", gap: 28, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: GOLD }}>{markedCount}</div>
          <div style={{ fontSize: 10, color: DIM, textTransform: "uppercase", letterSpacing: "0.5px" }}>Marked</div>
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#E8EDF5" }}>{events.length}</div>
          <div style={{ fontSize: 10, color: DIM, textTransform: "uppercase", letterSpacing: "0.5px" }}>Total Events</div>
        </div>
        {session?.cases?.name && (
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#E8EDF5" }}>{session.cases.name}</div>
            {session.cases.number && <div style={{ fontSize: 11, color: DIM }}>{session.cases.number}</div>}
          </div>
        )}
      </div>

      {/* Search */}
      <div style={{ padding: "10px 20px", background: DARK, borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search log…"
          style={{ width: "100%", background: NAVY, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "7px 12px", color: "#E8EDF5", fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
        />
      </div>

      {/* Event log */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
        {filtered.length === 0 && status === "connected" && (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ fontSize: 28, marginBottom: 12, animation: "breathe 3s ease-in-out infinite" }}>📋</div>
            <div style={{ fontSize: 14, color: MUTED }}>Waiting for session activity…</div>
            <div style={{ fontSize: 12, color: DIM, marginTop: 6 }}>Events will appear here as they happen</div>
          </div>
        )}

        {filtered.map((ev, i) => {
          const config = EVENT_CONFIG[ev.event_type] || { icon: "•", color: MUTED, label: ev.event_type };
          const isMarked = ev.event_type === "exhibit_marked";
          const time = new Date(ev.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

          return (
            <div key={ev.id || i} style={{
              display: "flex", gap: 14, marginBottom: 8,
              padding: isMarked ? "12px 16px" : "8px 16px",
              background: isMarked ? "#0D1F0D" : "transparent",
              border: isMarked ? `1px solid #2A5C3A` : `1px solid transparent`,
              borderRadius: 8,
              transition: "all 0.2s",
            }}>
              {/* Time */}
              <div style={{ fontSize: 11, color: DIM, fontFamily: "monospace", width: 72, flexShrink: 0, paddingTop: 2 }}>
                {time}
              </div>

              {/* Icon */}
              <div style={{
                width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                background: `${config.color}22`,
                border: `1px solid ${config.color}44`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, color: config.color, fontWeight: 700,
              }}>
                {config.icon}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {isMarked ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: GOLD }}>Exhibit {ev.exhibit_num}</span>
                      <span style={{ fontSize: 10, background: "#0D2D1A", color: GREEN, borderRadius: 3, padding: "1px 5px", fontWeight: 600 }}>MARKED INTO RECORD</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#E8EDF5" }}>{ev.exhibit_name}</div>
                    {ev.actor_name && <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>by {ev.actor_name}</div>}
                  </div>
                ) : (
                  <div>
                    <span style={{ fontSize: 12, color: config.color, fontWeight: 500 }}>{config.label}</span>
                    {ev.exhibit_name && <span style={{ fontSize: 12, color: MUTED }}> — {ev.exhibit_name}</span>}
                    {ev.actor_name && <div style={{ fontSize: 11, color: DIM, marginTop: 1 }}>{ev.actor_name}{ev.actor_role ? ` (${ev.actor_role.replace("_", " ")})` : ""}</div>}
                    {ev.notes && <div style={{ fontSize: 11, color: DIM, marginTop: 1, fontStyle: "italic" }}>{ev.notes}</div>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={logEndRef} />
      </div>

      {/* Footer */}
      <div style={{ background: NAVY, borderTop: `1px solid ${BORDER}`, padding: "7px 20px", display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: DIM }}>{session?.cases?.name}</span>
        <span style={{ fontSize: 11, color: "#1E3254" }}>Court Reporter · Read-only</span>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes breathe { 0%,100%{opacity:.4;transform:scale(1)} 50%{opacity:.85;transform:scale(1.06)} }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0A1628; }
        ::-webkit-scrollbar-thumb { background: #1E3254; border-radius: 2px; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
