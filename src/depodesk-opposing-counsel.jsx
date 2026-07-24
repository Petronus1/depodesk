// ============================================================
// DepoDesk — Opposing Counsel View (/opposing-counsel)
// ============================================================
// Shows:
//   - Live pushed exhibits (same as witness)
//   - Running log of all introduced exhibits this session
//   - Never sees the case library or unmarked exhibits
// ============================================================

import { useState, useEffect, useRef } from "react";
import { supabase, getExhibitFileUrl, privateChannel, uploadExhibitFile } from "./depodesk-supabase";
import PDFViewer from "./depodesk-pdfviewer";

import { GOLD, NAVY, DARK, BORDER, MUTED, DIM, GREEN } from "./theme";

export default function OpposingCounselView() {
  const [session, setSession]         = useState(null);
  const [currentExhibit, setCurrentExhibit] = useState(null);
  const [introducedExhibits, setIntroducedExhibits] = useState([]);
  const [fileUrl, setFileUrl]         = useState(null);
  const [status, setStatus]           = useState("connecting");
  const [activeTab, setActiveTab]     = useState("exhibit"); // exhibit | log
  const [hasControl, setHasControl]   = useState(false);
  const [caseId, setCaseId]           = useState(null);
  const [myPresented, setMyPresented] = useState(null); // { id, name, type, file_path, fileUrl } while OC presents
  const [presentBusy, setPresentBusy] = useState(false);
  const [reopened, setReopened]       = useState(null); // { name, num, url, type } marked file in modal
  const unsubRef                      = useRef(null);
  const chanRef                       = useRef(null);   // subscribed session channel for OC sends
  const fileInputRef                  = useRef(null);

  const sessionId     = sessionStorage.getItem("depo_session_id");
  const participantId = sessionStorage.getItem("depo_participant_id");
  const name          = sessionStorage.getItem("depo_participant_name");

  useEffect(() => {
    if (!sessionId || !participantId) { setStatus("error"); return; }

    async function connect() {
      try {
        // Wait for host approval before loading any session data
        const { data: pState } = await supabase.rpc("get_participant_state", { p_participant_id: participantId });
        const participant = pState?.[0];
        if (!participant) { setStatus("error"); return; }
        if (participant.status === "rejected") { setStatus("rejected"); return; }
        if (participant.status !== "approved") {
          setStatus("pending");
          const poll = setInterval(async () => {
            const { data: ps } = await supabase.rpc("get_participant_state", { p_participant_id: participantId });
            const p = ps?.[0];
            if (p?.status === "approved") { clearInterval(poll); connect(); }
            if (p?.status === "rejected") { clearInterval(poll); setStatus("rejected"); }
          }, 3000);
          unsubRef.current = () => clearInterval(poll);
          return;
        }

        // Load session
        const { data: sessRows } = await supabase.rpc("get_session_for_participant", {
          p_session_id: sessionId, p_participant_id: participantId,
        });
        const sess = sessRows?.[0] ?? null;
        setSession(sess);
        setCaseId(sess?.case_id ?? null);
        setHasControl(sess?.controller_role === "opposing_counsel");

        // Load already-introduced exhibits from session events
        const { data: events } = await supabase.rpc("get_session_events", {
          p_session_id: sessionId, p_participant_id: participantId,
        });
        if (events) setIntroducedExhibits(events.filter(e => e.event_type === "exhibit_marked"));

        setStatus("connected");

        // Subscribe to realtime
        const channel = privateChannel(`session:${sessionId}`)
          .on("broadcast", { event: "exhibit_push" }, ({ payload }) => {
            // OC does not receive its own broadcasts; a push here is the
            // host presenting, which supersedes OC's own presentation.
            setMyPresented(null);
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
            setIntroducedExhibits(prev =>
              prev.some(e => e.id && e.id === payload.event?.id) ? prev : [...prev, payload.event]);
          })
          .on("broadcast", { event: "exhibit_renumbered" }, ({ payload }) => {
            // Host renumbered an already-introduced exhibit — update its number
            // in place so the roster doesn't show a stale one until reload.
            // Matched by exhibit_id (the exhibit_marked events carry it).
            setIntroducedExhibits(prev => prev.map(e =>
              e.exhibit_id === payload.exhibit_id
                ? { ...e, exhibit_num: payload.new_num }
                : e));
          })
          .on("broadcast", { event: "control_transferred" }, ({ payload }) => {
            const oc = payload.controller_role === "opposing_counsel";
            setHasControl(oc);
            if (!oc) setMyPresented(null); // lost control → stop presenting
          })
          .on("broadcast", { event: "session_ended" }, () => {
            setStatus("ended");
          })
          .subscribe();

        chanRef.current = channel;
        unsubRef.current = () => { supabase.removeChannel(channel); chanRef.current = null; };
      } catch (err) {
        setStatus("error");
      }
    }

    connect();
    return () => unsubRef.current?.();
  }, [sessionId]);

  useEffect(() => {
    if (!participantId || status === "connecting" || status === "pending" || status === "rejected" || status === "error" || status === "ended" || status === "removed") return;
    const viewMap = { witness: "/witness", opposing_counsel: "/opposing-counsel", court_reporter: "/court-reporter" };
    const interval = setInterval(async () => {
      const { data: rows } = await supabase.rpc("get_participant_state", { p_participant_id: participantId });
      const data = rows?.[0];
      if (!data) return;
      if (data.status === "rejected") { clearInterval(interval); setStatus("removed"); return; }
      if (data.role !== "opposing_counsel") { clearInterval(interval); window.location.href = viewMap[data.role]; }
    }, 5000);
    return () => clearInterval(interval);
  }, [status]);

  // Present a document (only permitted while OC holds control). Upload to
  // the case folder, then broadcast an exhibit_push. The host ingests the
  // push and logs the audit event (participants can't write session_events).
  async function presentDocument(file) {
    if (!file || !caseId || !hasControl) return;
    setPresentBusy(true);
    try {
      const isImage = file.type.includes("image");
      const id   = `oc-${Date.now()}`;
      const path = await uploadExhibitFile(caseId, id, file);
      const url  = await getExhibitFileUrl(path);
      const exhibit = {
        id, name: file.name.replace(/\.[^.]+$/, ""),
        type: isImage ? "Image" : "PDF",
        file_path: path,
        introducedBy: "opposing_counsel",
        presenterName: name || "Opposing Counsel",
        marked: false, exhibitNum: null,
      };
      await chanRef.current?.send({ type: "broadcast", event: "exhibit_push", payload: { exhibit } });
      setMyPresented({ ...exhibit, fileUrl: url });
      setCurrentExhibit(null);
      setStatus("live");
    } catch (err) {
      console.error("Failed to present document:", err);
      alert("Could not present the document — you may not currently hold control.");
    } finally {
      setPresentBusy(false);
    }
  }

  async function stopPresenting() {
    await chanRef.current?.send({ type: "broadcast", event: "exhibit_push", payload: { exhibit: null } });
    setMyPresented(null);
  }

  // Re-open the (stamped) file of any already-marked exhibit — a read,
  // available regardless of control state.
  async function reopenMarked(ev) {
    if (!ev?.exhibit_file_path) return;
    try {
      const url = await getExhibitFileUrl(ev.exhibit_file_path);
      setReopened({
        name: ev.exhibit_name, num: ev.exhibit_num, url,
        type: ev.exhibit_mime_type?.includes("image") ? "Image" : "PDF",
      });
    } catch (err) {
      console.error("Could not open marked exhibit:", err);
    }
  }

  if (status === "pending") {
    return (
      <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: DARK, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#E8EDF5" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12, animation: "breathe 2s ease-in-out infinite" }}>⏳</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Waiting for approval</div>
          <div style={{ fontSize: 13, color: DIM, marginTop: 6 }}>Counsel must admit you before you can view the session.</div>
        </div>
        <style>{`@keyframes breathe { 0%,100%{opacity:.4;transform:scale(1)} 50%{opacity:.85;transform:scale(1.06)} }`}</style>
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
          {status !== "ended" && (
            <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 4, padding: "2px 8px",
              background: hasControl ? "#2D1E3A" : "#131F33",
              border: `1px solid ${hasControl ? "#5C3A7A" : BORDER}`,
              color: hasControl ? "#C07EE8" : DIM }}>
              {hasControl ? "You have control" : "Read-only"}
            </span>
          )}
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

      {/* Present toolbar — only while OC holds control */}
      {hasControl && activeTab === "exhibit" && status !== "ended" && (
        <div style={{ background: "#0A1628", borderBottom: `1px solid ${BORDER}`, padding: "8px 20px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: "#C07EE8", fontWeight: 600 }}>You may present exhibits</span>
          <input ref={fileInputRef} type="file" accept=".pdf,image/*" style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) presentDocument(e.target.files[0]); e.target.value = ""; }} />
          {!myPresented ? (
            <button disabled={presentBusy || !caseId} onClick={() => fileInputRef.current?.click()} style={{
              background: presentBusy ? "#2D1E3A" : "#C07EE8", color: presentBusy ? "#C07EE8" : NAVY,
              border: "none", borderRadius: 6, padding: "5px 13px", fontSize: 12, fontWeight: 700,
              cursor: presentBusy ? "default" : "pointer", fontFamily: "inherit",
            }}>{presentBusy ? "Uploading…" : "＋ Present a document"}</button>
          ) : (
            <button onClick={stopPresenting} style={{
              background: "#0D2D1A", border: "1px solid #2A5C3A", color: GREEN,
              borderRadius: 6, padding: "5px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}>✓ Stop presenting</button>
          )}
          <span style={{ marginLeft: "auto", fontSize: 11, color: DIM }}>The attorney marks presented exhibits into the record.</span>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Current Exhibit tab */}
        {activeTab === "exhibit" && (
          <>
            {/* OC is presenting their own document */}
            {myPresented && (
              <>
                <div style={{ background: NAVY, borderBottom: `1px solid ${BORDER}`, padding: "10px 20px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#E8EDF5" }}>{myPresented.name}</div>
                    <div style={{ fontSize: 11, color: "#C07EE8", marginTop: 2 }}>You are presenting this document</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#C07EE8" }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#C07EE8", animation: "pulse 1.5s infinite" }} />
                    Live to all
                  </div>
                </div>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  {myPresented.type === "Image"
                    ? <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}><img src={myPresented.fileUrl} alt={myPresented.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /></div>
                    : <PDFViewer url={myPresented.fileUrl} mode="host" sessionId={sessionId} exhibitId={myPresented.id} allowWitnessMarkup={false} />}
                </div>
              </>
            )}

            {!myPresented && currentExhibit && (
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
                    : <PDFViewer url={fileUrl} mode="observer" sessionId={sessionId} exhibitId={currentExhibit.id} />
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
                {introducedExhibits.map((ev, i) => {
                  const hasFile = !!ev.exhibit_file_path;
                  return (
                    <div key={ev.id || i} onClick={() => hasFile && reopenMarked(ev)} style={{
                      padding: "12px 16px", background: NAVY, border: `1px solid ${BORDER}`, borderRadius: 8, marginBottom: 8,
                      display: "flex", alignItems: "center", gap: 14,
                      cursor: hasFile ? "pointer" : "default",
                    }}>
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
                      {hasFile && <span style={{ fontSize: 11, color: GOLD, flexShrink: 0 }}>Open →</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ background: NAVY, borderTop: `1px solid ${BORDER}`, padding: "7px 20px", display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: DIM }}>{session?.case_name}</span>
        <span style={{ fontSize: 11, color: "#1E3254" }}>Opposing Counsel · {hasControl ? "Presenting" : "Read-only"}</span>
      </div>

      {/* Re-open a marked exhibit's file */}
      {reopened && (
        <div onClick={() => setReopened(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 400, display: "flex", flexDirection: "column", padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: DARK, border: `1px solid ${BORDER}`, borderRadius: 10, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ background: NAVY, borderBottom: `1px solid ${BORDER}`, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <div style={{ border: `2px solid ${GOLD}`, borderRadius: 4, padding: "2px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 8, color: GOLD, fontWeight: 800, letterSpacing: "1.5px" }}>EXHIBIT</div>
                <div style={{ fontSize: 16, fontWeight: 900, color: GOLD, lineHeight: 1.1 }}>{reopened.num}</div>
              </div>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{reopened.name}</div>
              <button onClick={() => setReopened(null)} style={{ background: "transparent", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>Close</button>
            </div>
            <div style={{ flex: 1, overflow: "hidden", background: "#1A1A1A", display: "flex", flexDirection: "column" }}>
              {reopened.type === "Image"
                ? <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}><img src={reopened.url} alt={reopened.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /></div>
                : <PDFViewer url={reopened.url} mode="witness" sessionId={null} exhibitId={`reopen-${reopened.num}`} />}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes breathe { 0%,100%{opacity:.4;transform:scale(1)} 50%{opacity:.85;transform:scale(1.06)} }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
