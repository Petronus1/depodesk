// ============================================================
// DepoDesk — Opposing Counsel View (/opposing-counsel)
// ============================================================
// Shows:
//   - Live pushed exhibits (same as witness)
//   - Running log of all introduced exhibits this session
//   - Never sees the case library or unmarked exhibits
// ============================================================

import { useState, useEffect, useRef } from "react";
import { supabase, getExhibitFileUrl } from "./depodesk-supabase";

const GOLD   = "#C9A84C";
const NAVY   = "#0F1B2D";
const DARK   = "#060E1A";
const BORDER = "#1E3254";
const MUTED  = "#7A93B8";
const DIM    = "#4A6080";
const GREEN  = "#4CAF82";

export default function OpposingCounselView() {
  const [session, setSession]         = useState(null);
  const [participant, setParticipant] = useState(null);
  const [currentExhibit, setCurrentExhibit] = useState(null);
  const [introducedExhibits, setIntroducedExhibits] = useState([]);
  const [fileUrl, setFileUrl]         = useState(null);
  const [status, setStatus]           = useState("connecting");
  const [activeTab, setActiveTab]     = useState("exhibit"); // exhibit | log
  const unsubRef                      = useRef(null);

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

        // Load already-introduced exhibits from session events
        const { data: events } = await supabase
          .from("session_events")
          .select("*")
          .eq("session_id", sessionId)
          .eq("event_type", "exhibit_marked")
          .order("created_at", { ascending: true });
        if (events) setIntroducedExhibits(events);

        setStatus("connected");

        // Subscribe to realtime
        const channel = supabase.channel(`session:${sessionId}`)
          .on("broadcast", { event: "exhibit_push" }, ({ payload }) => {
            if (!payload.exhibit) { setCurrentExhibit(null); setFileUrl(null); return; }
            setCurrentExhibit(payload.exhibit);
            setStatus("live");
            if (payload.exhibit.file_path) {
              getExhibitFileUrl(payload.exhibit.file_path).then(setFileUrl).catch(() => setFileUrl(null));
            } else {
              setFileUrl(null);
            }
          })
          .on("broadcast", { event: "exhibit_marked" }, ({ payload }) => {
            setIntroducedExhibits(prev => [...prev, payload.event]);
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

  if (status === "error" || !sessionId) {
    return (
      <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: DARK, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#E8EDF5" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: MUTED }}>Session not found</div>
          <div style={{ fontSize: 13, color: DIM, marginTop: 6 }}>Please use the join link provided by counsel.</div>
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
          <span style={{ fontSize: 12, color: DIM }}>— Opposing Counsel</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: DIM }}>{name}</span>
<span style={{ fontSize: 11, background: "#131F33", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "2px 8px", color: DIM, fontFamily: "monospace", letterSpacing: "2px" }}>
  PIN {sessionStorage.getItem("depo_pin")}
</span>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: status === "ended" ? "#F87171" : GREEN }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: status === "ended" ? "#F87171" : GREEN, animation: status !== "ended" ? "pulse 1.5s infinite" : "none" }} />
            {status === "ended" ? "Session ended" : "Connected"}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background: NAVY, borderBottom: `1px solid ${BORDER}`, padding: "0 20px", display: "flex", gap: 0, flexShrink: 0 }}>
        {[
          { id: "exhibit", label: "Current Exhibit" },
          { id: "log", label: `Introduced Exhibits (${introducedExhibits.length})` },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            background: "transparent", border: "none",
            borderBottom: `2px solid ${activeTab === tab.id ? GOLD : "transparent"}`,
            color: activeTab === tab.id ? "#E8EDF5" : DIM,
            padding: "12px 16px", fontSize: 12, fontWeight: activeTab === tab.id ? 600 : 400,
            cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Current Exhibit tab */}
        {activeTab === "exhibit" && (
          <>
            {currentExhibit && (
              <div style={{ background: NAVY, borderBottom: `1px solid ${BORDER}`, padding: "10px 20px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                {currentExhibit.marked && (
                  <div style={{ border: `2px solid ${GOLD}`, borderRadius: 4, padding: "3px 10px", textAlign: "center", flexShrink: 0 }}>
                    <div style={{ fontSize: 8, color: GOLD, fontWeight: 800, letterSpacing: "1.5px" }}>EXHIBIT</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: GOLD, lineHeight: 1.1 }}>{currentExhibit.exhibitNum}</div>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#E8EDF5" }}>{currentExhibit.name}</div>
                  {currentExhibit.date && <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>{currentExhibit.date}</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: GOLD }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: GOLD, animation: "pulse 1.5s infinite" }} />
                  Being presented
                </div>
              </div>
            )}

            <div style={{ flex: 1, overflow: "hidden" }}>
              {currentExhibit ? (
                fileUrl ? (
                  currentExhibit.type === "Image"
                    ? <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}><img src={fileUrl} alt={currentExhibit.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /></div>
                    : <iframe src={fileUrl} title={currentExhibit.name} style={{ width: "100%", height: "100%", border: "none" }} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ border: `2px solid ${GOLD}`, borderRadius: 8, padding: "20px 40px", textAlign: "center" }}>
                      <div style={{ fontSize: 10, color: GOLD, fontWeight: 800, letterSpacing: "2px" }}>EXHIBIT</div>
                      <div style={{ fontSize: 64, fontWeight: 900, color: GOLD, lineHeight: 1 }}>{currentExhibit.exhibitNum || "—"}</div>
                      <div style={{ fontSize: 14, color: MUTED, marginTop: 8 }}>{currentExhibit.name}</div>
                    </div>
                  </div>
                )
              ) : (
                <div style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
                  <div style={{ fontSize: 32, animation: "breathe 3s ease-in-out infinite" }}>⚖️</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: MUTED }}>Waiting for counsel to present an exhibit</div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Introduced Exhibits log tab */}
        {activeTab === "log" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {introducedExhibits.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 14, color: MUTED }}>No exhibits have been marked into the record yet</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 11, color: DIM, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 16 }}>
                  {introducedExhibits.length} Exhibit{introducedExhibits.length !== 1 ? "s" : ""} Introduced
                </div>
                {introducedExhibits.map((ev, i) => (
                  <div key={ev.id || i} style={{ padding: "12px 16px", background: NAVY, border: `1px solid ${BORDER}`, borderRadius: 8, marginBottom: 8, display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ border: `1px solid ${GOLD}`, borderRadius: 4, padding: "2px 8px", textAlign: "center", flexShrink: 0 }}>
                      <div style={{ fontSize: 8, color: GOLD, fontWeight: 800, letterSpacing: "1px" }}>EX.</div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: GOLD, lineHeight: 1 }}>{ev.exhibit_num}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#E8EDF5" }}>{ev.exhibit_name}</div>
                      <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>
                        Marked by {ev.actor_name} · {new Date(ev.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ background: NAVY, borderTop: `1px solid ${BORDER}`, padding: "7px 20px", display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: DIM }}>{session?.cases?.name}</span>
        <span style={{ fontSize: 11, color: "#1E3254" }}>Opposing Counsel · Read-only</span>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes breathe { 0%,100%{opacity:.4;transform:scale(1)} 50%{opacity:.85;transform:scale(1.06)} }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
