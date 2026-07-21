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
import { supabase, logSessionEvent, privateChannel } from "./depodesk-supabase";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Point PDF.js at its worker (copy from node_modules or use CDN)


const GOLD  = "#C9A84C";
const NAVY  = "#0F1B2D";
const DARK  = "#0A1628";
const BORDER = "#1E3254";
const MUTED  = "#7A93B8";
const DIM    = "#4A6080";
const GREEN  = "#4CAF82";

// ── Witness markup overlay ────────────────────────────────────
// Draws strokes stored in page-normalized coordinates (0..1) and,
// when active, captures new pen strokes with pointer events.
function MarkupCanvas({ strokes, active, onStroke }) {
  const ref     = useRef();
  const current = useRef(null); // in-progress stroke

  function redraw() {
    const c = ref.current;
    if (!c) return;
    const w = (c.width = c.offsetWidth);
    const h = (c.height = c.offsetHeight);
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    const all = [...(strokes || []), ...(current.current ? [current.current] : [])];
    for (const s of all) {
      if (!s.pts || s.pts.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = s.color || "#DD1111";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(s.pts[0].x * w, s.pts[0].y * h);
      s.pts.slice(1).forEach(p => ctx.lineTo(p.x * w, p.y * h));
      ctx.stroke();
    }
  }

  useEffect(redraw, [strokes]);

  function norm(e) {
    const r = ref.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  return (
    <canvas
      ref={ref}
      onPointerDown={e => {
        if (!active) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        current.current = { pts: [norm(e)], color: "#DD1111" };
      }}
      onPointerMove={e => {
        if (!active || !current.current) return;
        current.current.pts.push(norm(e));
        redraw();
      }}
      onPointerUp={() => {
        if (!active || !current.current) return;
        const s = current.current;
        current.current = null;
        if (s.pts.length >= 2) onStroke?.(s.pts);
        redraw();
      }}
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        cursor: active ? "crosshair" : "default",
        pointerEvents: active ? "auto" : "none",
        touchAction: "none",
      }}
    />
  );
}

// ── Single page renderer ──────────────────────────────────────
function PDFPage({ pdfDoc, pageNum, scale, rotation, isActive, markupStrokes, markupActive, onMarkupStroke }) {
  const canvasRef = useRef();

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    let renderTask = null;

    pdfDoc.getPage(pageNum).then(page => {
      if (cancelled) return;
      // Combine the page's own /Rotate with the user's rotation
      const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
      const canvas   = canvasRef.current;
      const ctx      = canvas.getContext("2d");
      canvas.width   = viewport.width;
      canvas.height  = viewport.height;
      renderTask = page.render({ canvasContext: ctx, viewport });
      renderTask.promise.catch(() => {}); // cancelled renders reject; ignore
    });

    return () => { cancelled = true; renderTask?.cancel(); };
  }, [pdfDoc, pageNum, scale, rotation]);

  return (
    <div style={{
      position: "relative",
      marginBottom: 16,
      boxShadow: isActive
        ? `0 0 0 2px ${GOLD}, 0 4px 24px rgba(0,0,0,0.4)`
        : "0 2px 12px rgba(0,0,0,0.3)",
      borderRadius: 3,
      transition: "box-shadow 0.2s",
    }}>
      {/* White background: PDFs without a painted background otherwise
          show as dark text on the app's dark theme */}
      <canvas ref={canvasRef} style={{ display: "block", borderRadius: 3, background: "#fff" }} />
      {(markupActive || markupStrokes?.length > 0) && (
        <MarkupCanvas strokes={markupStrokes} active={markupActive} onStroke={onMarkupStroke} />
      )}
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
  onSaveMarkup,         // host: called with witness strokes on "Save markup"
  hostControlsEnabled = true, // gate page-drive (off when someone else holds control)
  allowWitnessMarkup = true,  // gate the witness-markup feature (host-only; off for OC)
}) {
  const [pdfDoc, setPdfDoc]         = useState(null);
  const [numPages, setNumPages]     = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale]           = useState(1.3);
  const [rotation, setRotation]     = useState(0); // user rotation on top of page /Rotate
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [directed, setDirected]     = useState(false); // witness flash on forced jump
  const [markup, setMarkup]         = useState(null);  // { page } while witness markup is live
  const [markupStrokes, setMarkupStrokes] = useState([]); // [{ page, pts:[{x,y} 0..1], color }]
  const scrollRef       = useRef();
  const pageRefs        = useRef({});
  const hostChanRef     = useRef(null);
  const annotateChanRef = useRef(null); // witness: subscribed channel for sending strokes
  const isHost       = mode === "host";
  const isWitness    = mode === "witness";

  // ── Load PDF ──────────────────────────────────────────────
 useEffect(() => {
  if (!url) return;
  setLoading(true); setError(null); setPdfDoc(null);
  fetch(url)
    .then(r => r.arrayBuffer())
    .then(data => pdfjsLib.getDocument({ data }).promise)
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

  // ── Host: subscribe pdf-sync channel so we can send on it ──
  useEffect(() => {
    if (!isHost || !sessionId) return;
    const ch = privateChannel(`pdf-sync:${sessionId}`).subscribe();
    hostChanRef.current = ch;
    return () => { supabase.removeChannel(ch); hostChanRef.current = null; };
  }, [isHost, sessionId]);

  // ── Witness: page jumps + markup start/end on pdf-sync ────
  useEffect(() => {
    if (!isWitness || !sessionId) return;
    const ch = privateChannel(`pdf-sync:${sessionId}`)
      .on("broadcast", { event: "force_page" }, ({ payload }) => {
        if (payload.exhibitId !== exhibitId) return;
        setCurrentPage(payload.page);
        scrollToPage(payload.page);
        setDirected(true);
        setTimeout(() => setDirected(false), 1500);
      })
      .on("broadcast", { event: "annotation_start" }, ({ payload }) => {
        if (payload.exhibitId !== exhibitId) return;
        setMarkup({ page: payload.page });
        setMarkupStrokes([]);
        setCurrentPage(payload.page);
        scrollToPage(payload.page);
        // dedicated sendable channel: approved participants may
        // broadcast on annotate:<id> (and nothing else)
        annotateChanRef.current = privateChannel(`annotate:${sessionId}`).subscribe();
      })
      .on("broadcast", { event: "annotation_end" }, () => {
        setMarkup(null);
        setMarkupStrokes([]);
        if (annotateChanRef.current) { supabase.removeChannel(annotateChanRef.current); annotateChanRef.current = null; }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
      if (annotateChanRef.current) { supabase.removeChannel(annotateChanRef.current); annotateChanRef.current = null; }
    };
  }, [isWitness, sessionId, exhibitId]);

  // ── Host: receive witness strokes while markup is live ────
  useEffect(() => {
    if (!isHost || !sessionId) return;
    const ch = privateChannel(`annotate:${sessionId}`)
      .on("broadcast", { event: "stroke" }, ({ payload }) => {
        if (payload.exhibitId !== exhibitId) return;
        setMarkupStrokes(prev => [...prev, payload.stroke]);
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [isHost, sessionId, exhibitId]);

  // Witness: record a finished stroke locally and send it to the host
  function handleMarkupStroke(pts) {
    if (!markup) return;
    const stroke = { page: markup.page, pts, color: "#DD1111" };
    setMarkupStrokes(prev => [...prev, stroke]);
    annotateChanRef.current?.send({ type: "broadcast", event: "stroke", payload: { exhibitId, stroke } });
  }

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

        <div style={{ width: 1, height: 18, background: BORDER }} />

        {/* Rotate (court scans are often sideways or upside down) */}
        <button onClick={() => setRotation(r => (r + 90) % 360)} title="Rotate 90°" style={btnStyle}>⟳</button>

        {/* Witness: directed flash indicator */}
        {isWitness && directed && !markup && (
          <span style={{ fontSize: 11, color: GOLD, marginLeft: "auto", animation: "fadeout 1.5s forwards" }}>
            ⬆ Counsel directed you here
          </span>
        )}

        {/* Witness: markup mode indicator */}
        {isWitness && markup && (
          <span style={{ fontSize: 11, color: "#F87171", marginLeft: "auto", fontWeight: 700 }}>
            ✏️ Please mark page {markup.page} as directed by counsel
          </span>
        )}

        {/* Host but control is with opposing counsel: no present actions */}
        {isHost && !hostControlsEnabled && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#C07EE8", fontWeight: 600 }}>
            Opposing counsel has control
          </span>
        )}

        {/* Host: direct witness + witness markup controls */}
        {isHost && hostControlsEnabled && (
          <>
            <div style={{ marginLeft: "auto" }} />
            {sessionId && !markup && allowWitnessMarkup && (
              <button
                onClick={() => {
                  setMarkupStrokes([]);
                  setMarkup({ page: currentPage });
                  hostChanRef.current?.send({ type: "broadcast", event: "annotation_start", payload: { exhibitId, page: currentPage } });
                  logSessionEvent(sessionId, "witness_markup_started", { actor_role: "host", notes: `Witness asked to mark page ${currentPage}` });
                }}
                style={{
                  background: "transparent", border: "1px solid #5C3A7A", color: "#C07EE8",
                  borderRadius: 6, padding: "5px 14px", fontSize: 11,
                  fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                }}>
                ✏️ Witness markup
              </button>
            )}
            {sessionId && markup && (
              <>
                <span style={{ fontSize: 11, color: "#C07EE8", fontWeight: 600 }}>
                  Witness marking page {markup.page} · {markupStrokes.length} mark{markupStrokes.length !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={() => {
                    hostChanRef.current?.send({ type: "broadcast", event: "annotation_end", payload: { exhibitId } });
                    const strokes = markupStrokes;
                    setMarkup(null);
                    setMarkupStrokes([]);
                    if (strokes.length > 0) onSaveMarkup?.(strokes);
                  }}
                  style={{
                    background: GREEN, color: NAVY, border: "none",
                    borderRadius: 6, padding: "5px 14px", fontSize: 11,
                    fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}>
                  ✓ Save markup
                </button>
                <button
                  onClick={() => {
                    hostChanRef.current?.send({ type: "broadcast", event: "annotation_end", payload: { exhibitId } });
                    setMarkup(null);
                    setMarkupStrokes([]);
                  }}
                  style={{
                    background: "transparent", border: "1px solid #5C1A1A", color: "#F87171",
                    borderRadius: 6, padding: "5px 10px", fontSize: 11,
                    cursor: "pointer", fontFamily: "inherit",
                  }}>
                  ✕ Discard
                </button>
              </>
            )}
            {!markup && (
              <button
                onClick={() => {
                  hostChanRef.current?.send({ type: "broadcast", event: "force_page", payload: { exhibitId, page: currentPage } });
                  if (sessionId) logSessionEvent(sessionId, "page_direct", { actor_role: "host", notes: `Directed witness to page ${currentPage}` });
                }}
                style={{
                  background: GOLD, color: NAVY, border: "none",
                  borderRadius: 6, padding: "5px 14px", fontSize: 11,
                  fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                }}>
                ⬆ Direct witness to page {currentPage}
              </button>
            )}
          </>
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
              rotation={rotation}
              isActive={pageNum === currentPage}
              markupStrokes={markupStrokes.filter(s => s.page === pageNum)}
              markupActive={isWitness && markup?.page === pageNum}
              onMarkupStroke={handleMarkupStroke}
            />
          </div>
        ))}
      </div>

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeout { 0%{opacity:1} 70%{opacity:1} 100%{opacity:0} }
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
