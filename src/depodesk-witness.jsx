// ============================================================
// DepoDesk — Witness View Page
// ============================================================
// SETUP:
//   This is a standalone page/route that witnesses open.
//   No login required — access is via a one-time session token.
//
// ROUTING (React Router example):
//   import WitnessView from "./depodesk-witness"
//   <Route path="/witness" element={<WitnessView />} />
//
// URL FORMAT:
//   https://yourdomain.com/witness?token=abc123def456
//
// HOW IT WORKS:
//   1. Attorney starts a session → gets a witness_token from Supabase
//   2. Witness URL is built: /witness?token=<witness_token>
//   3. Witness opens the URL — no account needed
//   4. Page subscribes to Supabase Realtime on that session channel
//   5. When attorney hits "Share with All", exhibit pushes instantly
// ============================================================

import { useState, useEffect, useRef } from "react";
import { getSessionByToken, subscribeToSession, getExhibitFileUrl } from "./depodesk-supabase";

const GOLD  = "#C9A84C";
const NAVY  = "#0F1B2D";
const DARK  = "#060E1A";
const BORDER = "#1E3254";
const MUTED  = "#7A93B8";
const DIM    = "#4A6080";
const GREEN  = "#4CAF82";

// ── Status indicator ─────────────────────────────────────────
function StatusPill({ status }) {
  const config = {
    connecting: { color: MUTED,  dot: "#4A6080", label: "Connecting…"       },
    connected:  { color: GREEN,  dot: GREEN,     label: "Connected to session" },
    waiting:    { color: MUTED,  dot: MUTED,     label: "Waiting for exhibit"  },
    live:       { color: GREEN,  dot: GREEN,     label: "Exhibit presented"    },
    ended:      { color: "#F87171", dot: "#F87171", label: "Session ended"     },
    error:      { color: "#F87171", dot: "#F87171", label: "Connection error"  },
  }[status] || { color: MUTED, dot: MUTED, label: status };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: config.color }}>
      <div style={{
        width: 7, height: 7, borderRadius: "50%", background: config.dot,
        animation: ["connected","live"].includes(status) ? "pulse 1.5s infinite" : "none",
      }} />
      {config.label}
    </div>
  );
}

// ── Exhibit sticker ──────────────────────────────────────────
function ExhibitSticker({ exhibit, caseName }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 24px", background: NAVY, borderBottom: `1px solid ${BORDER}` }}>
      {/* Docket badge */}
      <div style={{ border: `2px solid ${GOLD}`, borderRadius: 5, padding: "4px 14px", textAlign: "center", flexShrink: 0 }}>
        <div style={{ fontSize: 8, color: GOLD, fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase" }}>Exhibit</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: GOLD, lineHeight: 1.1 }}>{exhibit.displayNum}</div>
      </div>

      {/* Exhibit info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#E8EDF5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {exhibit.name}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 3, alignItems: "center" }}>
          {caseName && <span style={{ fontSize: 11, color: DIM }}>{caseName}</span>}
          {exhibit.document_date && <span style={{ fontSize: 11, color: DIM }}>{exhibit.document_date}</span>}
          {exhibit.type && (
            <span style={{ fontSize: 10, background: "#1E3A5F", color: "#7EB3E8", borderRadius: 3, padding: "1px 6px", fontWeight: 600 }}>
              {exhibit.type}
            </span>
          )}
        </div>
      </div>

      {/* Live indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: GOLD, flexShrink: 0 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD, animation: "pulse 1.5s infinite" }} />
        Presented by counsel
      </div>
    </div>
  );
}

// ── Document viewer ──────────────────────────────────────────
function ExhibitViewer({ exhibit }) {
  const [fileUrl, setFileUrl] = useState(null);
  const [loadingFile, setLoadingFile] = useState(false);

  useEffect(() => {
    if (!exhibit?.file_path) { setFileUrl(null); return; }
    setLoadingFile(true);
    getExhibitFileUrl(exhibit.file_path)
      .then(setFileUrl)
      .catch(() => setFileUrl(null))
      .finally(() => setLoadingFile(false));
  }, [exhibit?.file_path, exhibit?.id]);

  if (loadingFile) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 12, animation: "spin 1s linear infinite" }}>⏳</div>
          <div style={{ fontSize: 13, color: DIM }}>Loading document…</div>
        </div>
      </div>
    );
  }

  if (fileUrl) {
    if (exhibit.type === "Image") {
      return (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32, overflow: "hidden" }}>
          <img src={fileUrl} alt={exhibit.name}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4 }} />
        </div>
      );
    }
    return (
      <iframe src={fileUrl} title={exhibit.name}
        style={{ flex: 1, border: "none", width: "100%", display: "block" }} />
    );
  }

  // No file — show exhibit sticker placeholder
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ display: "inline-block", border: `2px solid ${GOLD}`, borderRadius: 8, padding: "20px 40px", marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: GOLD, fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase" }}>Exhibit</div>
          <div style={{ fontSize: 72, fontWeight: 900, color: GOLD, lineHeight: 1 }}>{exhibit.displayNum}</div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, color: "#E8EDF5", marginBottom: 6 }}>{exhibit.name}</div>
        <div style={{ fontSize: 13, color: DIM }}>No digital file — refer to physical copy</div>
      </div>
    </div>
  );
}

// ── Waiting state ────────────────────────────────────────────
function WaitingScreen({ caseName, caseNumber }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 32 }}>
      <div style={{
        width: 80, height: 80, border: `2px solid ${BORDER}`, borderRadius: 16,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 36, animation: "breathe 3s ease-in-out infinite",
      }}>⚖️</div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: MUTED, marginBottom: 6 }}>
          Waiting for counsel to present an exhibit
        </div>
        {caseName && (
          <div style={{ fontSize: 13, color: DIM }}>
            {caseName}{caseNumber ? ` · ${caseNumber}` : ""}
          </div>
        )}
      </div>
      <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: "50%", background: BORDER,
            animation: `dotPulse 1.4s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

// ── Error / ended states ─────────────────────────────────────
function MessageScreen({ icon, title, subtitle }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 32 }}>
      <div style={{ fontSize: 40 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#E8EDF5", textAlign: "center" }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: DIM, textAlign: "center", maxWidth: 300, lineHeight: 1.6 }}>{subtitle}</div>}
    </div>
  );
}

// ── Main Witness View ─────────────────────────────────────────
export default function WitnessView() {
  const [status, setStatus]         = useState("connecting");
  const [session, setSession]       = useState(null);
  const [exhibit, setExhibit]       = useState(null);
  const [flash, setFlash]           = useState(false);
  const unsubRef                    = useRef(null);

  // Parse token from URL: /witness?token=abc123
  const token = new URLSearchParams(window.location.search).get("token");

  useEffect(() => {
    if (!token) { setStatus("error"); return; }

    async function connect() {
      try {
        // 1. Look up the session by token
        const sess = await getSessionByToken(token);
        setSession(sess);
        setStatus("waiting");

        // 2. Subscribe to real-time exhibit pushes
        unsubRef.current = subscribeToSession(sess.id, (pushedExhibit) => {
          if (!pushedExhibit) {
            // Counsel stopped sharing
            setExhibit(null);
            setStatus("waiting");
            return;
          }
          // Flash animation on new exhibit
          setFlash(true);
          setTimeout(() => setFlash(false), 600);
          setExhibit(pushedExhibit);
          setStatus("live");
        });

      } catch (err) {
        console.error("Witness connect error:", err);
        setStatus(err.message?.includes("No rows") ? "error" : "error");
      }
    }

    connect();
    return () => unsubRef.current?.();
  }, [token]);

  const caseName   = session?.cases?.name;
  const caseNumber = session?.cases?.number;

  return (
    <div style={{
      fontFamily: "'Inter', system-ui, sans-serif",
      background: DARK, minHeight: "100vh",
      color: "#E8EDF5", display: "flex", flexDirection: "column",
    }}>

      {/* ── Header ── */}
      <div style={{
        background: NAVY, borderBottom: `1px solid ${BORDER}`,
        padding: "0 20px", height: 52,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
        transition: "background 0.3s",
        ...(flash ? { background: "#0D2033" } : {}),
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 26, height: 26, background: GOLD, borderRadius: 4,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 900, fontSize: 13, color: NAVY,
          }}>D</div>
          <span style={{ fontWeight: 700, fontSize: 14 }}>DepoDesk</span>
          <span style={{ fontSize: 12, color: DIM }}>— Witness View</span>
        </div>
        <StatusPill status={status} />
      </div>

      {/* ── Exhibit header bar (when exhibit is shown) ── */}
      {exhibit && status === "live" && (
        <ExhibitSticker exhibit={exhibit} caseName={caseName} />
      )}

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {status === "connecting" && (
          <MessageScreen icon="🔌" title="Connecting to session…" subtitle="Please wait while we establish a secure connection." />
        )}
        {status === "error" && !token && (
          <MessageScreen icon="🔗" title="Invalid witness link" subtitle="This link appears to be incomplete or expired. Please ask counsel for a new witness link." />
        )}
        {status === "error" && token && (
          <MessageScreen icon="⚠️" title="Session not found" subtitle="This session may have ended or the link may be invalid. Please ask counsel to start a new session and share a fresh link." />
        )}
        {status === "ended" && (
          <MessageScreen icon="✅" title="Deposition session ended" subtitle="Counsel has ended this session. Thank you." />
        )}
        {(status === "waiting" || status === "connected") && (
          <WaitingScreen caseName={caseName} caseNumber={caseNumber} />
        )}
        {status === "live" && exhibit && (
          <ExhibitViewer exhibit={exhibit} />
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{
        background: NAVY, borderTop: `1px solid ${BORDER}`,
        padding: "8px 20px", display: "flex", alignItems: "center",
        justifyContent: "space-between", flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: DIM }}>
          {caseName ? `${caseName}${caseNumber ? " · " + caseNumber : ""}` : "DepoDesk Witness View"}
        </span>
        <span style={{ fontSize: 11, color: "#1E3254" }}>Read-only · No account required</span>
      </div>

      <style>{`
        @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes breathe  { 0%,100%{opacity:.4;transform:scale(1)} 50%{opacity:.85;transform:scale(1.06)} }
        @keyframes dotPulse { 0%,80%,100%{transform:scale(0);opacity:.3} 40%{transform:scale(1);opacity:1} }
        @keyframes spin     { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
