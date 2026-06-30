// ============================================================
// DepoDesk — PDF Viewer with Page Sync
// ============================================================
// Shared component used by both the attorney app and witness view.
//
// SETUP:
//   npm install pdfjs-dist
//
// USAGE (Attorney side — broadcasts page changes):
//   <PDFViewer
//     url={signedUrl}
//     mode="host"
//     sessionId={session.id}
//     exhibitId={exhibit.id}
//   />
//
// USAGE (Witness side — receives page changes):
//   <PDFViewer
//     url={signedUrl}
//     mode="witness"
//     sessionId={session.id}
//     exhibitId={exhibit.id}
//   />
// ============================================================

import { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { supabase } from "./depodesk-supabase";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Point PDF.js at its worker (copy from node_modules or use CDN)


const GOLD  = "#C9A84C";
const NAVY  = "#0F1B2D";
const DARK  = "#0A1628";
const BORDER = "#1E3254";
const MUTED  = "#7A93B8";
const DIM    = "#4A6080";
const GREEN  = "#4CAF82";

// ── Broadcast helpers ─────────────────────────────────────────
function getChannel(sessionId) {
  return supabase.channel(`pdf-sync:${sessionId}`);
}

async function broadcastPage(sessionId, exhibitId, page) {
  const ch = getChannel(sessionId);
  await ch.send({
    type: "broadcast",
    event: "page_change",
    payload: { exhibitId, page },
  });
}

function subscribeToPagesync(sessionId, onPage) {
  const ch = getChannel(sessionId)
    .on("broadcast", { event: "page_change" }, ({ payload }) => {
      onPage(payload.exhibitId, payload.page);
    })
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// ── Single page renderer ──────────────────────────────────────
function PDFPage({ pdfDoc, pageNum, scale, isActive }) {
  const canvasRef = useRef();

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;

    pdfDoc.getPage(pageNum).then(page => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas   = canvasRef.current;
      const ctx      = canvas.getContext("2d");
      canvas.width   = viewport.width;
      canvas.height  = viewport.height;
      page.render({ canvasContext: ctx, viewport });
    });

    return () => { cancelled = true; };
  }, [pdfDoc, pageNum, scale]);

  return (
    <div style={{
      marginBottom: 16,
      boxShadow: isActive
        ? `0 0 0 2px ${GOLD}, 0 4px 24px rgba(0,0,0,0.4)`
        : "0 2px 12px rgba(0,0,0,0.3)",
      borderRadius: 3,
      transition: "box-shadow 0.2s",
    }}>
      <canvas ref={canvasRef} style={{ display: "block", borderRadius: 3 }} />
    </div>
  );
}

// ── Main PDF Viewer ───────────────────────────────────────────
export default function PDFViewer({
  url,
  mode = "host",        // "host" (attorney) | "witness"
  sessionId,
  exhibitId,
  onPageChange,         // optional callback for parent
}) {
  const [pdfDoc, setPdfDoc]         = useState(null);
  const [numPages, setNumPages]     = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale]           = useState(1.3);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [followCounsel, setFollowCounsel] = useState(true); // witness only
  const [counselPage, setCounselPage]     = useState(null); // witness only — tracks host's page
  const [jumped, setJumped]         = useState(false);
  const scrollRef  = useRef();
  const pageRefs   = useRef({});
  const isHost     = mode === "host";
  const isWitness  = mode === "witness";

  // ── Load PDF ──────────────────────────────────────────────
 useEffect(() => {
  if (!url) return;
  console.log("PDFViewer loading URL:", url);
  setLoading(true); setError(null); setPdfDoc(null);
  pdfjsLib.getDocument(url).promise
    .then(doc => { setPdfDoc(doc); setNumPages(doc.numPages); setCurrentPage(1); })
    .catch(err => {
      console.error("PDF.js load error:", err);
      setError("Failed to load PDF. The file may be unavailable.");
    })
    .finally(() => setLoading(false));
}, [url]);

  // ── Scroll to page ────────────────────────────────────────
  const scrollToPage = useCallback((page) => {
    const el = pageRefs.current[page];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // ── Host: broadcast page when it changes ──────────────────
  useEffect(() => {
    if (!isHost || !sessionId || !exhibitId || !pdfDoc) return;
    broadcastPage(sessionId, exhibitId, currentPage);
    onPageChange?.(currentPage);
  }, [currentPage, isHost, sessionId, exhibitId]);

  // ── Witness: subscribe to host page changes ───────────────
  useEffect(() => {
    if (!isWitness || !sessionId) return;
    const unsub = subscribeToPagesync(sessionId, (eid, page) => {
      if (eid !== exhibitId) return;
      setCounselPage(page);
      if (followCounsel) {
        setCurrentPage(page);
        scrollToPage(page);
      }
    });
    return unsub;
  }, [isWitness, sessionId, exhibitId, followCounsel]);

  // ── Scroll tracking → update currentPage ──────────────────
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length > 0) {
          const page = parseInt(visible[0].target.dataset.page);
          if (!isNaN(page)) setCurrentPage(page);
        }
      },
      { root: container, threshold: 0.5 }
    );
    Object.values(pageRefs.current).forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [pdfDoc, numPages]);

  function jumpToCounsel() {
    if (counselPage) { scrollToPage(counselPage); setCurrentPage(counselPage); }
    setJumped(true);
    setTimeout(() => setJumped(false), 1500);
  }

  function toggleFollow(val) {
    setFollowCounsel(val);
    if (val && counselPage) { scrollToPage(counselPage); setCurrentPage(counselPage); }
  }

  // ── States ────────────────────────────────────────────────
  if (loading) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 14 }}>
      <div style={{ width: 36, height: 36, border: `3px solid ${BORDER}`, borderTopColor: GOLD, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ fontSize: 13, color: DIM }}>Loading PDF…</div>
    </div>
  );

  if (error) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 28 }}>⚠️</div>
      <div style={{ fontSize: 14, color: "#F87171" }}>{error}</div>
    </div>
  );

  if (!pdfDoc) return null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>

      {/* ── Toolbar ── */}
      <div style={{
        background: NAVY, borderBottom: `1px solid ${BORDER}`,
        padding: "7px 16px", display: "flex", alignItems: "center",
        gap: 10, flexShrink: 0, flexWrap: "wrap",
      }}>

        {/* Page navigation */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => { const p = Math.max(1, currentPage - 1); setCurrentPage(p); scrollToPage(p); }}
            disabled={currentPage === 1}
            style={{ ...btnStyle, opacity: currentPage === 1 ? 0.3 : 1 }}>‹</button>
          <span style={{ fontSize: 12, color: MUTED, minWidth: 70, textAlign: "center" }}>
            Page {currentPage} of {numPages}
          </span>
          <button onClick={() => { const p = Math.min(numPages, currentPage + 1); setCurrentPage(p); scrollToPage(p); }}
            disabled={currentPage === numPages}
            style={{ ...btnStyle, opacity: currentPage === numPages ? 0.3 : 1 }}>›</button>
        </div>

        <div style={{ width: 1, height: 18, background: BORDER }} />

        {/* Zoom */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => setScale(s => Math.max(0.6, s - 0.2))} style={btnStyle}>−</button>
          <span style={{ fontSize: 12, color: DIM, minWidth: 40, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(3, s + 0.2))} style={btnStyle}>+</button>
        </div>

        {/* Witness-only controls */}
        {isWitness && (
          <>
            <div style={{ width: 1, height: 18, background: BORDER }} />

            {/* Follow / Free toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 1, background: DARK, borderRadius: 6, padding: 2, border: `1px solid ${BORDER}` }}>
              <button
                onClick={() => toggleFollow(false)}
                style={{
                  ...toggleBtn,
                  background: !followCounsel ? "#162540" : "transparent",
                  color: !followCounsel ? "#E8EDF5" : DIM,
                  border: !followCounsel ? `1px solid ${BORDER}` : "1px solid transparent",
                }}>
                Free Scroll
              </button>
              <button
                onClick={() => toggleFollow(true)}
                style={{
                  ...toggleBtn,
                  background: followCounsel ? "#0D2D1A" : "transparent",
                  color: followCounsel ? GREEN : DIM,
                  border: followCounsel ? `1px solid #2A5C3A` : "1px solid transparent",
                }}>
                {followCounsel ? "● Follow Counsel" : "Follow Counsel"}
              </button>
            </div>

            {/* Jump to current button (shown in free scroll mode when out of sync) */}
            {!followCounsel && counselPage && counselPage !== currentPage && (
              <button onClick={jumpToCounsel} style={{
                background: jumped ? "#0D2D1A" : GOLD,
                color: jumped ? GREEN : NAVY,
                border: jumped ? `1px solid #2A5C3A` : "none",
                borderRadius: 6, padding: "5px 12px", fontSize: 11,
                fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.2s",
              }}>
                {jumped ? "✓ Jumped" : `↩ Jump to counsel (p.${counselPage})`}
              </button>
            )}

            {/* Counsel page indicator */}
            {counselPage && (
              <span style={{ fontSize: 11, color: DIM, marginLeft: "auto" }}>
                Counsel on p.{counselPage}
              </span>
            )}
          </>
        )}

        {/* Host: page indicator */}
        {isHost && (
          <span style={{ fontSize: 11, color: DIM, marginLeft: "auto" }}>
            Broadcasting page {currentPage} to witnesses
          </span>
        )}
      </div>

      {/* ── Pages ── */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: "auto", padding: "24px 0",
        display: "flex", flexDirection: "column", alignItems: "center",
        background: "#1A1A1A",
      }}>
        {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
          <div
            key={pageNum}
            data-page={pageNum}
            ref={el => pageRefs.current[pageNum] = el}
            style={{ scrollMarginTop: 24 }}
          >
            <PDFPage
              pdfDoc={pdfDoc}
              pageNum={pageNum}
              scale={scale}
              isActive={pageNum === currentPage}
            />
          </div>
        ))}
      </div>

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #111; }
        ::-webkit-scrollbar-thumb { background: #1E3254; border-radius: 3px; }
      `}</style>
    </div>
  );
}

const btnStyle = {
  background: "transparent", border: `1px solid ${BORDER}`,
  color: MUTED, borderRadius: 5, width: 28, height: 28,
  cursor: "pointer", fontSize: 15, fontFamily: "inherit",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 0,
};

const toggleBtn = {
  borderRadius: 5, padding: "4px 10px", fontSize: 11,
  fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  transition: "all 0.15s",
};
