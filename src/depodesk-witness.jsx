import { useState, useEffect, useRef } from "react";
import { supabase, getExhibitFileUrl, privateChannel } from "./depodesk-supabase";
import PDFViewer from "./depodesk-pdfviewer";

import { GOLD, NAVY, DARK, BORDER, MUTED, DIM, GREEN } from "./theme";

export default function WitnessView() {
  const [session, setSession]       = useState(null);
  const [exhibit, setExhibit]       = useState(null);
  const [fileUrl, setFileUrl]       = useState(null);
  const [status, setStatus]         = useState("connecting");
  const [flash, setFlash]           = useState(false);
  const unsubRef                    = useRef(null);

  const sessionId     = sessionStorage.getItem("depo_session_id");
  const participantId = sessionStorage.getItem("depo_participant_id");
  const name          = sessionStorage.getItem("depo_participant_name");

  useEffect(() => {
    if (!sessionId) { setStatus("error"); return; }

    async function connect() {
      try {
        // Wait for host approval before joining the session channel
        const { data: pState } = await supabase.rpc("get_participant_state", { p_participant_id: participantId });
        const participant = pState?.[0];
        if (participant?.status === "rejected") { setStatus("rejected"); return; }
        if (participant?.status !== "approved") {
          // Poll until approved or rejected
          const poll = setInterval(async () => {
            const { data: ps } = await supabase.rpc("get_participant_state", { p_participant_id: participantId });
            const p = ps?.[0];
            if (p?.status === "approved") { clearInterval(poll); connect(); }
            if (p?.status === "rejected") { clearInterval(poll); setStatus("rejected"); }
          }, 3000);
          unsubRef.current = () => clearInterval(poll);
          return;
        }

        const { data: sessRows } = await supabase.rpc("get_session_for_participant", {
          p_session_id: sessionId, p_participant_id: participantId,
        });
        setSession(sessRows?.[0] ?? null);
        setStatus("waiting");

        const channel = privateChannel(`session:${sessionId}`)
          .on("broadcast", { event: "exhibit_push" }, ({ payload }) => {
            if (!payload.exhibit) {
              setExhibit(null); setFileUrl(null); setStatus("waiting"); return;
            }
            setFlash(true);
            setTimeout(() => setFlash(false), 600);
            setExhibit(payload.exhibit);
            setStatus("live");
            if (payload.exhibit.file_path) {
              getExhibitFileUrl(payload.exhibit.file_path).then(setFileUrl).catch(() => setFileUrl(null));
            } else {
              setFileUrl(null);
            }
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

  // Poll for role changes or being kicked after admission
  useEffect(() => {
    if (!participantId || status === "connecting" || status === "error" || status === "ended" || status === "rejected" || status === "removed") return;
    const viewMap = { witness: "/witness", opposing_counsel: "/opposing-counsel", court_reporter: "/court-reporter" };
    const interval = setInterval(async () => {
      const { data: rows } = await supabase.rpc("get_participant_state", { p_participant_id: participantId });
      const data = rows?.[0];
      if (!data) return;
      if (data.status === "rejected") { clearInterval(interval); setStatus("removed"); return; }
      if (data.role !== "witness") { clearInterval(interval); window.location.href = viewMap[data.role]; }
    }, 5000);
    return () => clearInterval(interval);
  }, [status]);

  if (!sessionId || status === "error") {
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

  if (status === "removed") {
    return (
      <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: DARK, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#E8EDF5" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🚫</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#F87171" }}>Removed from Session</div>
          <div style={{ fontSize: 13, color: DIM, marginTop: 6 }}>Counsel has removed you from the session.</div>
        </div>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: DARK, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#E8EDF5" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🚫</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#F87171" }}>Entry Declined</div>
          <div style={{ fontSize: 13, color: DIM, marginTop: 6 }}>Counsel has declined your request to join.</div>
          <a href="/join" style={{ display: "inline-block", marginTop: 16, color: GOLD, fontSize: 13 }}>← Back to Join</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: DARK, height: "100vh", color: "#E8EDF5", display: "flex", flexDirection: "column" }}>
      <div style={{
        background: flash ? "#0D2033" : NAVY, borderBottom: `1px solid ${BORDER}`,
        padding: "0 20px", height: 52,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0, transition: "background 0.3s",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 24, height: 24, background: GOLD, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 12, color: NAVY }}>D</div>
          <span style={{ fontWeight: 700, fontSize: 14 }}>DepoDesk</span>
          <span style={{ fontSize: 12, color: DIM }}>— Witness View</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {name && <span style={{ fontSize: 12, color: DIM }}>{name}</span>}
<span style={{ fontSize: 11, background: "#131F33", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "2px 8px", color: DIM, fontFamily: "monospace", letterSpacing: "2px" }}>
  PIN {session?.pin || sessionStorage.getItem("depo_pin")}
</span>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: status === "ended" ? "#F87171" : GREEN }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: status === "ended" ? "#F87171" : GREEN, animation: status !== "ended" ? "pulse 1.5s infinite" : "none" }} />
            {status === "ended" ? "Session ended" : status === "waiting" ? "Waiting for exhibit" : "Exhibit presented"}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {exhibit && status === "live" && (
          <div style={{ background: NAVY, borderBottom: `1px solid ${BORDER}`, padding: "10px 24px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
            {exhibit.marked && (
              <div style={{ border: `2px solid ${GOLD}`, borderRadius: 4, padding: "3px 10px", textAlign: "center", flexShrink: 0 }}>
                <div style={{ fontSize: 8, color: GOLD, fontWeight: 800, letterSpacing: "1.5px" }}>EXHIBIT</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: GOLD, lineHeight: 1.1 }}>{exhibit.exhibitNum}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#E8EDF5" }}>{exhibit.name}</div>
              {exhibit.date && <div style={{ fontSize: 12, color: DIM, marginTop: 2 }}>{exhibit.date}</div>}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: GOLD }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD, animation: "pulse 1.5s infinite" }} />
              Presented by counsel
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {status === "ended" ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
              <div style={{ fontSize: 36 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: MUTED }}>Deposition session ended</div>
            </div>
          ) : exhibit ? (
            fileUrl ? (
              exhibit.type === "Image"
                ? <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}><img src={fileUrl} alt={exhibit.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /></div>
                : <PDFViewer url={fileUrl} mode="witness" sessionId={sessionId} exhibitId={exhibit.id} />
            ) : (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ border: `2px solid ${GOLD}`, borderRadius: 8, padding: "20px 40px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: GOLD, fontWeight: 800, letterSpacing: "2px" }}>EXHIBIT</div>
                  <div style={{ fontSize: 64, fontWeight: 900, color: GOLD, lineHeight: 1 }}>{exhibit.exhibitNum || "—"}</div>
                  <div style={{ fontSize: 14, color: MUTED, marginTop: 8 }}>{exhibit.name}</div>
                </div>
              </div>
            )
          ) : (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
              <div style={{ width: 72, height: 72, border: `2px solid ${BORDER}`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, animation: "breathe 3s ease-in-out infinite" }}>⚖️</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: MUTED }}>Waiting for counsel to present an exhibit</div>
              <div style={{ fontSize: 13, color: DIM }}>Documents will appear here automatically</div>
            </div>
          )}
        </div>
      </div>

      <div style={{ background: NAVY, borderTop: `1px solid ${BORDER}`, padding: "7px 20px", display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: DIM }}>{session?.case_name || "Deposition"}</span>
        <span style={{ fontSize: 11, color: "#1E3254" }}>Witness · Read-only</span>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes breathe { 0%,100%{opacity:.4;transform:scale(1)} 50%{opacity:.85;transform:scale(1.06)} }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}