// ============================================================
// DepoDesk — Attorney annotation layer (private, host-only)
// ============================================================
// The attorney's own private markup over an exhibit in the main app
// (pen / highlight / sticky note / eraser). This is NOT the live
// witness-markup feature (that lives in depodesk-pdfviewer.jsx) — these
// strokes are local to the attorney and persisted in localStorage.
//
//   <AnnotationToolbar tool color setTool setColor onClear />
//   <AnnotationLayer exhibitId tool color annotations setAnnotations />
// ============================================================

import { useState, useRef, useEffect } from "react";

export function AnnotationLayer({ exhibitId, tool, color, annotations, setAnnotations }) {
  const canvasRef = useRef();
  const drawing = useRef(false);
  const strokes = annotations[exhibitId]?.strokes || [];
  const notes   = annotations[exhibitId]?.notes   || [];
  function getAnn() { return annotations[exhibitId] || { strokes: [], notes: [] }; }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(s => {
      if (!s.pts || s.pts.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.tool === "highlight" ? 18 : 3;
      ctx.globalAlpha = s.tool === "highlight" ? 0.3 : 1;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.moveTo(s.pts[0].x, s.pts[0].y);
      s.pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }, [strokes]);

  function pt(e) {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onMouseDown(e) {
    if (tool === "note") {
      const p = pt(e);
      const text = prompt("Note text:");
      if (!text) return;
      const ann = getAnn();
      setAnnotations(prev => ({ ...prev, [exhibitId]: { ...ann, notes: [...ann.notes, { id: Date.now(), x: p.x, y: p.y, text, color }] } }));
      return;
    }
    if (tool === "eraser") {
      const ann = getAnn();
      setAnnotations(prev => ({ ...prev, [exhibitId]: { ...ann, strokes: ann.strokes.slice(0, -1) } }));
      return;
    }
    drawing.current = true;
    const p = pt(e);
    const ann = getAnn();
    setAnnotations(prev => ({ ...prev, [exhibitId]: { ...ann, strokes: [...ann.strokes, { id: Date.now(), tool, color, pts: [p] }] } }));
  }

  function onMouseMove(e) {
    if (!drawing.current) return;
    const p = pt(e);
    setAnnotations(prev => {
      const ann = prev[exhibitId] || { strokes: [], notes: [] };
      const ss = [...ann.strokes];
      const last = { ...ss[ss.length - 1], pts: [...ss[ss.length - 1].pts, p] };
      ss[ss.length - 1] = last;
      return { ...prev, [exhibitId]: { ...ann, strokes: ss } };
    });
  }

  function onMouseUp() { drawing.current = false; }
  const cursor = { pen: "crosshair", highlight: "text", note: "cell", eraser: "not-allowed", none: "default" }[tool] || "default";

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: tool === "none" ? "none" : "auto" }}>
      <canvas ref={canvasRef}
        width={canvasRef.current?.parentElement?.clientWidth || 800}
        height={canvasRef.current?.parentElement?.clientHeight || 600}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp} />
      {notes.map(n => (
        <div key={n.id} style={{
          position: "absolute", left: n.x, top: n.y,
          background: n.color === "#EAD637" ? "#FFF9C4" : n.color === "#F87171" ? "#FEE2E2" : "#D1FAE5",
          border: `1px solid ${n.color}`, borderRadius: 4, padding: "6px 10px",
          maxWidth: 180, fontSize: 12, color: "#1a1a1a",
          boxShadow: "2px 2px 8px rgba(0,0,0,0.3)", zIndex: 10,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 3, color: "#666", textTransform: "uppercase" }}>Note</div>
          {n.text}
          <div onClick={() => { const ann = getAnn(); setAnnotations(prev => ({ ...prev, [exhibitId]: { ...ann, notes: ann.notes.filter(x => x.id !== n.id) } })); }}
            style={{ position: "absolute", top: 2, right: 5, cursor: "pointer", fontSize: 14, color: "#999" }}>×</div>
        </div>
      ))}
    </div>
  );
}

export function AnnotationToolbar({ tool, setTool, color, setColor, onClear }) {
  const tools = [
    { id: "none", icon: "↖", label: "Select" },
    { id: "pen", icon: "✏️", label: "Draw" },
    { id: "highlight", icon: "▐", label: "Highlight" },
    { id: "note", icon: "📝", label: "Note" },
    { id: "eraser", icon: "⌫", label: "Undo" },
  ];
  const colors = ["#F87171","#EAD637","#4CAF82","#60A5FA","#C084FC","#FFFFFF"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#0A1628", border: "1px solid #1E3254", borderRadius: 8, padding: "5px 8px" }}>
      {tools.map(t => (
        <button key={t.id} title={t.label} onClick={() => setTool(t.id)} style={{
          background: tool === t.id ? "#162540" : "transparent",
          border: tool === t.id ? "1px solid #C9A84C" : "1px solid transparent",
          borderRadius: 5, padding: "4px 9px", cursor: "pointer",
          fontSize: 14, color: tool === t.id ? "#C9A84C" : "#7A93B8",
        }}>{t.icon}</button>
      ))}
      <div style={{ width: 1, height: 20, background: "#1E3254", margin: "0 4px" }} />
      {colors.map(c => (
        <div key={c} onClick={() => setColor(c)} style={{
          width: 16, height: 16, borderRadius: "50%", background: c, cursor: "pointer",
          border: color === c ? "2px solid #C9A84C" : "2px solid transparent", flexShrink: 0,
        }} />
      ))}
      <div style={{ width: 1, height: 20, background: "#1E3254", margin: "0 4px" }} />
      <button onClick={onClear} style={{ background: "transparent", border: "1px solid transparent", borderRadius: 5, padding: "4px 8px", cursor: "pointer", fontSize: 11, color: "#7A93B8" }}>Clear</button>
    </div>
  );
}
