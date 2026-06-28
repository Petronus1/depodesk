import { useState, useRef, useCallback, useEffect } from "react";

// ─── Storage helpers ──────────────────────────────────────────────────────────
const STORAGE_KEY = "depodesk-cases-v2";
const ANN_KEY     = "depodesk-annotations-v1";
const META_KEY    = "depodesk-meta-v2";

async function storageGet(key) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}
async function storageSet(key, value) {
  try { await window.storage.set(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
async function storageDel(key) {
  try { await window.storage.delete(key); } catch {}
}

function sanitizeCases(cases) {
  return cases.map(c => ({
    ...c,
    library: (c.library || []).map(e => ({ ...e, fileUrl: null })),
    depositions: (c.depositions || []).map(d => ({
      ...d,
      exhibits: (d.exhibits || []).map(e => ({ ...e, fileUrl: null })),
    })),
  }));
}

// ─── Seed Data ───────────────────────────────────────────────────────────────
const SEED_CASES = [
  {
    id: "case-1",
    name: "Smith v. Acme Corp.",
    number: "2024-CV-00142",
    court: "S.D.N.Y.",
    date: "2024-03-15",
    status: "active",
    library: [
      { id: 1, label: "Exhibit 1", name: "Employment Agreement", type: "PDF", date: "2019-03-15", tags: ["contract"], fileUrl: null, marked: false },
      { id: 2, label: "Exhibit 2", name: "Email Chain – HR Dept.", type: "Email", date: "2021-07-22", tags: ["communications"], fileUrl: null, marked: false },
      { id: 3, label: "Exhibit 3", name: "Performance Review Q4", type: "PDF", date: "2022-01-10", tags: ["HR"], fileUrl: null, marked: false },
      { id: 4, label: "Exhibit 4", name: "Termination Letter", type: "PDF", date: "2022-05-03", tags: ["contract"], fileUrl: null, marked: false },
    ],
    depositions: [
      {
        id: "depo-1",
        witness: "John Smith",
        date: "2024-04-10",
        caption: "Smith v. Acme Corp., 2024-CV-00142",
        exhibits: [
          { id: 1, label: "Exhibit 1", name: "Employment Agreement", type: "PDF", date: "2019-03-15", tags: ["contract"], fileUrl: null, marked: true },
          { id: 3, label: "Exhibit 2", name: "Performance Review Q4", type: "PDF", date: "2022-01-10", tags: ["HR"], fileUrl: null, marked: false },
        ],
      },
      {
        id: "depo-2",
        witness: "Sarah Chen",
        date: "2024-05-02",
        caption: "Smith v. Acme Corp., 2024-CV-00142",
        exhibits: [
          { id: 2, label: "Exhibit 1", name: "Email Chain – HR Dept.", type: "Email", date: "2021-07-22", tags: ["communications"], fileUrl: null, marked: false },
          { id: 4, label: "Exhibit 2", name: "Termination Letter", type: "PDF", date: "2022-05-03", tags: ["contract"], fileUrl: null, marked: false },
        ],
      },
    ],
  },
  {
    id: "case-2",
    name: "Rivera v. Metropolitan Transit",
    number: "2024-CV-00389",
    court: "E.D.N.Y.",
    date: "2024-06-01",
    status: "active",
    library: [
      { id: 10, label: "Exhibit 1", name: "Incident Report", type: "PDF", date: "2023-11-04", tags: ["incident"], fileUrl: null, marked: false },
      { id: 11, label: "Exhibit 2", name: "Medical Records", type: "PDF", date: "2023-11-10", tags: ["medical"], fileUrl: null, marked: false },
    ],
    depositions: [
      {
        id: "depo-3",
        witness: "Carlos Rivera",
        date: "2024-07-15",
        caption: "Rivera v. Metropolitan Transit, 2024-CV-00389",
        exhibits: [
          { id: 10, label: "Exhibit 1", name: "Incident Report", type: "PDF", date: "2023-11-04", tags: ["incident"], fileUrl: null, marked: false },
        ],
      },
    ],
  },
];

const typeColors = {
  PDF:   { bg: "#1E3A5F", text: "#7EB3E8" },
  Email: { bg: "#2D1E3A", text: "#C07EE8" },
  Image: { bg: "#1E3A2D", text: "#7EE8A0" },
  Video: { bg: "#3A2D1E", text: "#E8C07E" },
};

const statusColors = {
  active:  { bg: "#0D2D1A", text: "#4CAF82", border: "#2A5C3A", label: "Active" },
  closed:  { bg: "#1A1A2E", text: "#7A93B8", border: "#1E3254", label: "Closed" },
  pending: { bg: "#2D2200", text: "#C9A84C", border: "#5C4400", label: "Pending" },
};

const CHANNEL = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("depodesk") : null;

function useSharedState(initial) {
  const [state, setState] = useState(initial);
  useEffect(() => {
    if (!CHANNEL) return;
    const handler = (e) => { if (e.data?.type === "SYNC") setState(e.data.payload); };
    CHANNEL.addEventListener("message", handler);
    return () => CHANNEL.removeEventListener("message", handler);
  }, []);
  function broadcast(payload) { setState(payload); CHANNEL?.postMessage({ type: "SYNC", payload }); }
  return [state, broadcast];
}

// ─── Annotation Layer ─────────────────────────────────────────────────────────
function AnnotationLayer({ exhibitId, tool, color, annotations, setAnnotations }) {
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

function AnnotationToolbar({ tool, setTool, color, setColor, onClear }) {
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

// ─── Witness View ─────────────────────────────────────────────────────────────
function WitnessView({ sharedExhibit }) {
  const [pulse, setPulse] = useState(false);
  useEffect(() => { setPulse(true); const t = setTimeout(() => setPulse(false), 600); return () => clearTimeout(t); }, [sharedExhibit?.id]);
  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#060E1A", minHeight: "100vh", color: "#E8EDF5", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#0A1628", borderBottom: "1px solid #1E3254", padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 24, height: 24, background: "#C9A84C", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, color: "#0F1B2D" }}>D</div>
          <span style={{ fontWeight: 700, fontSize: 14 }}>DepoDesk</span>
          <span style={{ fontSize: 12, color: "#4A6080", marginLeft: 4 }}>— Witness View</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4CAF82" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4CAF82", animation: "pulse 1.5s infinite" }} />
          Connected
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {sharedExhibit ? (
          <>
            <div style={{ background: "#0A1628", borderBottom: "1px solid #1E3254", padding: "10px 24px", display: "flex", alignItems: "center", gap: 14, ...(pulse ? { background: "#0D2033" } : {}) }}>
              <div style={{ border: "2px solid #C9A84C", borderRadius: 4, padding: "3px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 8, color: "#C9A84C", fontWeight: 800, letterSpacing: "1.5px" }}>EXHIBIT</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: "#C9A84C", lineHeight: 1 }}>{sharedExhibit.id}</div>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{sharedExhibit.name}</div>
                {sharedExhibit.caseName && <div style={{ fontSize: 11, color: "#4A6080", marginTop: 1 }}>{sharedExhibit.caseName}</div>}
              </div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#C9A84C" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#C9A84C", animation: "pulse 1.5s infinite" }} />
                Presented by counsel
              </div>
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              {sharedExhibit.fileUrl ? (
                sharedExhibit.type === "Image"
                  ? <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}><img src={sharedExhibit.fileUrl} alt={sharedExhibit.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /></div>
                  : <iframe src={sharedExhibit.fileUrl} title={sharedExhibit.name} style={{ width: "100%", height: "100%", border: "none" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ border: "2px solid #C9A84C", borderRadius: 6, padding: "16px 32px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#C9A84C", fontWeight: 800, letterSpacing: "2px" }}>EXHIBIT</div>
                    <div style={{ fontSize: 64, fontWeight: 900, color: "#C9A84C", lineHeight: 1 }}>{sharedExhibit.id}</div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
            <div style={{ width: 72, height: 72, border: "2px solid #1E3254", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, animation: "breathe 3s ease-in-out infinite" }}>⚖️</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#4A6080" }}>Waiting for counsel to present an exhibit</div>
          </div>
        )}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}} @keyframes breathe{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.8;transform:scale(1.05)}} *{box-sizing:border-box}`}</style>
    </div>
  );
}

// ─── Cases Panel ──────────────────────────────────────────────────────────────
function CasesPanel({ cases, activeCaseId, onSelectCase, onNewCase, onDeleteCase, onResetData }) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", number: "", court: "", status: "active" });
  const inputStyle = { width: "100%", background: "#0A1628", border: "1px solid #1E3254", borderRadius: 6, padding: "7px 10px", color: "#E8EDF5", fontSize: 13, outline: "none", boxSizing: "border-box" };

  function submit() {
    if (!form.name.trim()) return;
    onNewCase({ ...form, date: new Date().toISOString().slice(0, 10) });
    setForm({ name: "", number: "", court: "", status: "active" });
    setShowNew(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "14px 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "#4A6080", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px" }}>{cases.length} Case{cases.length !== 1 ? "s" : ""}</span>
        <button onClick={() => setShowNew(v => !v)} style={{
          background: showNew ? "#162540" : "#C9A84C", color: showNew ? "#7A93B8" : "#0F1B2D",
          border: showNew ? "1px solid #1E3254" : "none",
          borderRadius: 5, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
        }}>{showNew ? "Cancel" : "+ New"}</button>
      </div>

      {showNew && (
        <div style={{ margin: "0 12px 10px", background: "#131F33", border: "1px solid #1E3254", borderRadius: 8, padding: 12 }}>
          {[{ label: "Case Name *", key: "name", placeholder: "Smith v. Jones" }, { label: "Case No.", key: "number", placeholder: "2024-CV-00001" }, { label: "Court", key: "court", placeholder: "S.D.N.Y." }].map(f => (
            <div key={f.key} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: "#4A6080", fontWeight: 600, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.4px" }}>{f.label}</div>
              <input value={form[f.key]} placeholder={f.placeholder} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} style={inputStyle} />
            </div>
          ))}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#4A6080", fontWeight: 600, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.4px" }}>Status</div>
            <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} style={inputStyle}>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <button onClick={submit} style={{ width: "100%", background: "#C9A84C", color: "#0F1B2D", border: "none", borderRadius: 6, padding: "7px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Create Case</button>
        </div>
      )}

      <div style={{ overflowY: "auto", flex: 1 }}>
        {cases.map(c => {
          const sc = statusColors[c.status] || statusColors.active;
          const isActive = c.id === activeCaseId;
          const depoCount = (c.depositions || []).length;
          return (
            <div key={c.id} onClick={() => onSelectCase(c.id)} style={{
              padding: "11px 14px", borderBottom: "1px solid #1A2D47", cursor: "pointer",
              background: isActive ? "#162540" : "transparent",
              borderLeft: isActive ? "3px solid #C9A84C" : "3px solid transparent",
              transition: "background 0.15s", position: "relative",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? "#E8EDF5" : "#C8D6E8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 }}>{c.name}</div>
                  {c.number && <div style={{ fontSize: 11, color: "#4A6080", marginBottom: 3 }}>{c.number}</div>}
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, borderRadius: 3, padding: "1px 6px", fontWeight: 600 }}>{sc.label}</span>
                    {c.court && <span style={{ fontSize: 10, color: "#4A6080" }}>{c.court}</span>}
                    <span style={{ fontSize: 10, color: "#4A6080" }}>{depoCount} depo{depoCount !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                {cases.length > 1 && (
                  <div onClick={e => { e.stopPropagation(); if (confirm(`Delete "${c.name}"?`)) onDeleteCase(c.id); }}
                    style={{ color: "#2A3F58", fontSize: 14, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}>×</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: "8px 14px", borderTop: "1px solid #1A2D47" }}>
        <button onClick={onResetData} style={{ width: "100%", background: "transparent", border: "1px solid #1A2D47", color: "#2A3F58", borderRadius: 5, padding: "5px", fontSize: 10, cursor: "pointer" }}>Reset to sample data</button>
      </div>
    </div>
  );
}

// ─── Depositions Panel ────────────────────────────────────────────────────────
function DepositionsPanel({ activeCase, activeDepoId, onSelectDepo, onNewDepo, onDeleteDepo }) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ witness: "", date: "", caption: "" });
  const depositions = activeCase?.depositions || [];
  const inputStyle = { width: "100%", background: "#0A1628", border: "1px solid #1E3254", borderRadius: 6, padding: "7px 10px", color: "#E8EDF5", fontSize: 12, outline: "none", boxSizing: "border-box" };

  function submit() {
    if (!form.witness.trim()) return;
    onNewDepo({
      ...form,
      caption: form.caption || activeCase?.number || "",
    });
    setForm({ witness: "", date: "", caption: "" });
    setShowNew(false);
  }

  if (!activeCase) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontSize: 12, color: "#2A3F58" }}>Select a case</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "12px 14px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1A2D47" }}>
        <div>
          <div style={{ fontSize: 11, color: "#4A6080", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.7px" }}>Depositions</div>
          <div style={{ fontSize: 10, color: "#2A3F58", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>{activeCase.name}</div>
        </div>
        <button onClick={() => setShowNew(v => !v)} style={{
          background: showNew ? "#162540" : "#C9A84C", color: showNew ? "#7A93B8" : "#0F1B2D",
          border: showNew ? "1px solid #1E3254" : "none",
          borderRadius: 5, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
        }}>{showNew ? "Cancel" : "+ New"}</button>
      </div>

      {showNew && (
        <div style={{ margin: "8px 12px", background: "#131F33", border: "1px solid #1E3254", borderRadius: 8, padding: 12 }}>
          {[
            { label: "Witness Name *", key: "witness", placeholder: "John Smith" },
            { label: "Date", key: "date", type: "date" },
            { label: "Caption", key: "caption", placeholder: activeCase?.number || "Case caption" },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: "#4A6080", fontWeight: 600, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.4px" }}>{f.label}</div>
              <input type={f.type || "text"} value={form[f.key]} placeholder={f.placeholder || ""}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} style={inputStyle} />
            </div>
          ))}
          <button onClick={submit} style={{ width: "100%", background: "#C9A84C", color: "#0F1B2D", border: "none", borderRadius: 6, padding: "7px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Create Deposition</button>
        </div>
      )}

      {/* Case Library link */}
      <div
        onClick={() => onSelectDepo("__library__")}
        style={{
          padding: "10px 14px", borderBottom: "1px solid #1A2D47", cursor: "pointer",
          background: activeDepoId === "__library__" ? "#162540" : "transparent",
          borderLeft: activeDepoId === "__library__" ? "3px solid #C9A84C" : "3px solid transparent",
        }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: activeDepoId === "__library__" ? "#C9A84C" : "#7A93B8" }}>📁 Case Library</div>
        <div style={{ fontSize: 10, color: "#4A6080", marginTop: 2 }}>{(activeCase.library || []).length} exhibits · shared pool</div>
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {depositions.length === 0 && (
          <div style={{ padding: "20px 14px", textAlign: "center", color: "#2A3F58", fontSize: 12 }}>
            No depositions yet.<br />
            <span style={{ color: "#C9A84C", cursor: "pointer" }} onClick={() => setShowNew(true)}>Add one →</span>
          </div>
        )}
        {depositions.map(d => {
          const isActive = d.id === activeDepoId;
          const markedCount = d.exhibits.filter(e => e.marked).length;
          return (
            <div key={d.id} onClick={() => onSelectDepo(d.id)} style={{
              padding: "11px 14px", borderBottom: "1px solid #1A2D47", cursor: "pointer",
              background: isActive ? "#162540" : "transparent",
              borderLeft: isActive ? "3px solid #C9A84C" : "3px solid transparent",
              transition: "background 0.15s",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: isActive ? "#E8EDF5" : "#C8D6E8", marginBottom: 2 }}>
                    {d.witness}
                  </div>
                  {d.date && <div style={{ fontSize: 10, color: "#4A6080", marginBottom: 3 }}>{d.date}</div>}
                  {d.caption && <div style={{ fontSize: 10, color: "#2A3F58", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.caption}</div>}
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: "#4A6080" }}>{d.exhibits.length} exhibit{d.exhibits.length !== 1 ? "s" : ""}</span>
                    {markedCount > 0 && <span style={{ fontSize: 10, background: "#0D2D1A", color: "#4CAF82", borderRadius: 3, padding: "1px 5px", fontWeight: 600 }}>✓ {markedCount} marked</span>}
                  </div>
                </div>
                <div onClick={e => { e.stopPropagation(); if (confirm(`Delete deposition of ${d.witness}?`)) onDeleteDepo(d.id); }}
                  style={{ color: "#2A3F58", fontSize: 14, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}>×</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const isWitness = window.location.hash === "#witness";

  const [cases, setCases]               = useState(SEED_CASES);
  const [activeCaseId, setActiveCaseId] = useState(SEED_CASES[0].id);
  const [activeDepoId, setActiveDepoId] = useState("__library__");
  const [activeExhibitId, setActiveExhibitId] = useState(null);
  const [search, setSearch]             = useState("");
  const [sharedId, setSharedId]         = useSharedState(null);
  const [showAddExhibit, setShowAddExhibit] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showWitnessModal, setShowWitnessModal] = useState(false);
  const [newExhibit, setNewExhibit]     = useState({ name: "", type: "PDF", date: "", tags: "" });
  const [notification, setNotification] = useState(null);
  const [dragOver, setDragOver]         = useState(false);
  const [modalFile, setModalFile]       = useState(null);
  const [annotations, setAnnotations]   = useState({});
  const [annTool, setAnnTool]           = useState("none");
  const [annColor, setAnnColor]         = useState("#F87171");
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [saveStatus, setSaveStatus]     = useState("idle");
  const saveTimer = useRef(null);
  const fileInputRef   = useRef();
  const attachInputRef = useRef();

  const activeCase = cases.find(c => c.id === activeCaseId);
  const isLibrary  = activeDepoId === "__library__";
  const activeDepo = isLibrary ? null : activeCase?.depositions?.find(d => d.id === activeDepoId);
  const exhibits   = isLibrary ? (activeCase?.library || []) : (activeDepo?.exhibits || []);
  const activeExhibit = exhibits.find(e => e.id === activeExhibitId);
  const sharedExhibit = exhibits.find(e => e.id === sharedId);

  const filtered = exhibits.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.label.toLowerCase().includes(search.toLowerCase()) ||
    e.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  // Witness
  const [witnessExhibit, setWitnessExhibit] = useState(null);
  useEffect(() => {
    if (!isWitness || !CHANNEL) return;
    CHANNEL.postMessage({ type: "REQUEST_STATE" });
    const handler = (e) => { if (e.data?.type === "EXHIBIT_PUSH") setWitnessExhibit(e.data.payload); };
    CHANNEL.addEventListener("message", handler);
    return () => CHANNEL.removeEventListener("message", handler);
  }, [isWitness]);

  useEffect(() => {
    if (isWitness || !CHANNEL) return;
    const handler = (e) => {
      if (e.data?.type === "REQUEST_STATE" && sharedId) {
        const ex = exhibits.find(x => x.id === sharedId);
        if (ex) CHANNEL.postMessage({ type: "EXHIBIT_PUSH", payload: { ...ex, caseName: activeCase?.name } });
      }
    };
    CHANNEL.addEventListener("message", handler);
    return () => CHANNEL.removeEventListener("message", handler);
  }, [isWitness, sharedId, exhibits]);

  // Storage
  useEffect(() => {
    if (isWitness) return;
    async function load() {
      const savedCases = await storageGet(STORAGE_KEY);
      const savedAnns  = await storageGet(ANN_KEY);
      const savedMeta  = await storageGet(META_KEY);
      if (savedCases && savedCases.length > 0) {
        setCases(savedCases);
        setActiveCaseId(savedMeta?.activeCaseId || savedCases[0].id);
        setActiveDepoId(savedMeta?.activeDepoId || "__library__");
      }
      if (savedAnns) setAnnotations(savedAnns);
      setStorageReady(true);
    }
    load();
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(async () => {
      await storageSet(STORAGE_KEY, sanitizeCases(cases));
      await storageSet(ANN_KEY, annotations);
      await storageSet(META_KEY, { activeCaseId, activeDepoId });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [cases, annotations, activeCaseId, activeDepoId, storageReady]);

  if (isWitness) return <WitnessView sharedExhibit={witnessExhibit} />;

  // ── Helpers ──────────────────────────────────────────────────
  function notify(msg, color = "#C9A84C") { setNotification({ msg, color }); setTimeout(() => setNotification(null), 2800); }

  function updateCases(fn) { setCases(prev => fn(prev)); }

  function updateExhibits(fn) {
    updateCases(prev => prev.map(c => {
      if (c.id !== activeCaseId) return c;
      if (isLibrary) return { ...c, library: fn(c.library || []) };
      return {
        ...c,
        depositions: c.depositions.map(d =>
          d.id === activeDepoId ? { ...d, exhibits: fn(d.exhibits) } : d
        ),
      };
    }));
  }

  function selectCase(id) {
    setActiveCaseId(id);
    setActiveDepoId("__library__");
    setActiveExhibitId(null);
    setSearch("");
    setSharedId(null);
  }

  function selectDepo(id) {
    setActiveDepoId(id);
    setActiveExhibitId(null);
    setSearch("");
    setSharedId(null);
    setShowAnnotations(false);
    setAnnTool("none");
  }

  function addCase(data) {
    const id = "case-" + Date.now();
    updateCases(prev => [...prev, { id, ...data, library: [], depositions: [] }]);
    setActiveCaseId(id);
    setActiveDepoId("__library__");
    setActiveExhibitId(null);
    notify(`Case "${data.name}" created`);
  }

  function deleteCase(id) {
    const remaining = cases.filter(c => c.id !== id);
    updateCases(() => remaining);
    if (activeCaseId === id) { setActiveCaseId(remaining[0]?.id || null); setActiveDepoId("__library__"); setActiveExhibitId(null); }
    notify("Case deleted", "#F87171");
  }

  function addDepo(data) {
    const id = "depo-" + Date.now();
    updateCases(prev => prev.map(c =>
      c.id === activeCaseId
        ? { ...c, depositions: [...(c.depositions || []), { id, ...data, exhibits: [] }] }
        : c
    ));
    setActiveDepoId(id);
    setActiveExhibitId(null);
    notify(`Deposition of ${data.witness} created`);
  }

  function deleteDepo(id) {
    updateCases(prev => prev.map(c =>
      c.id === activeCaseId
        ? { ...c, depositions: (c.depositions || []).filter(d => d.id !== id) }
        : c
    ));
    if (activeDepoId === id) { setActiveDepoId("__library__"); setActiveExhibitId(null); }
    notify("Deposition deleted", "#F87171");
  }

  // Import exhibits from case library into active deposition
  function importFromLibrary(exhibitIds) {
    const library = activeCase?.library || [];
    const toImport = library.filter(e => exhibitIds.includes(e.id));
    const existing = activeDepo?.exhibits || [];
    const existingIds = existing.map(e => e.id);
    const newOnes = toImport.filter(e => !existingIds.includes(e.id));
    if (newOnes.length === 0) { notify("All selected exhibits already in this deposition"); return; }
    // Renumber labels for this deposition
    const startNum = existing.length + 1;
    const renumbered = newOnes.map((e, i) => ({ ...e, label: `Exhibit ${startNum + i}`, marked: false }));
    updateExhibits(exs => [...exs, ...renumbered]);
    notify(`${newOnes.length} exhibit${newOnes.length !== 1 ? "s" : ""} imported`, "#4CAF82");
    setShowImportModal(false);
  }

  function shareExhibit(id) {
    setSharedId(id);
    const ex = exhibits.find(e => e.id === id);
    CHANNEL?.postMessage({ type: "EXHIBIT_PUSH", payload: { ...ex, caseName: activeCase?.name } });
    notify(`${ex.label} shared with all participants`);
  }

  function stopSharing() { setSharedId(null); CHANNEL?.postMessage({ type: "EXHIBIT_PUSH", payload: null }); }

  function markExhibit(id) {
    // Find the next available case-wide exhibit number
    const allMarked = [];
    const c = activeCase;
    (c?.library || []).forEach(e => { if (e.exhibitNum) allMarked.push(e.exhibitNum); });
    (c?.depositions || []).forEach(d => d.exhibits.forEach(e => { if (e.exhibitNum) allMarked.push(e.exhibitNum); }));
    const nextNum = allMarked.length > 0 ? Math.max(...allMarked) + 1 : 1;
    const label = `Exhibit ${nextNum}`;

    // Mark in current deposition/library and assign number
    updateExhibits(exs => exs.map(e => e.id === id ? { ...e, marked: true, exhibitNum: nextNum, label } : e));

    // Also update the same exhibit everywhere else in this case (library + all depos)
    updateCases(prev => prev.map(c => {
      if (c.id !== activeCaseId) return c;
      return {
        ...c,
        library: (c.library || []).map(e => e.id === id ? { ...e, marked: true, exhibitNum: nextNum, label } : e),
        depositions: (c.depositions || []).map(d => ({
          ...d,
          exhibits: d.exhibits.map(e => e.id === id ? { ...e, marked: true, exhibitNum: nextNum, label } : e),
        })),
      };
    }));

    notify(`${label} marked into the record`, "#4CAF82");
  }

  function attachFile(exhibitId, file) {
    if (!file) return;
    const url  = URL.createObjectURL(file);
    const type = file.type.includes("pdf") ? "PDF" : file.type.includes("image") ? "Image" : "PDF";
    updateExhibits(exs => exs.map(e => e.id === exhibitId ? { ...e, fileUrl: url, type } : e));
    notify("File attached", "#4CAF82");
  }

  function addExhibit(file) {
    if (!newExhibit.name.trim() && !file) return;
    const url  = file ? URL.createObjectURL(file) : null;
    const type = file ? (file.type.includes("pdf") ? "PDF" : "Image") : newExhibit.type;
    const name = newExhibit.name.trim() || (file ? file.name.replace(/\.[^.]+$/, "") : "Untitled");
    const newId = Date.now();

    // No exhibit number or label until marked — just use name
    const newExhibitObj = {
      id: newId,
      label: null,       // assigned when marked
      exhibitNum: null,  // assigned when marked
      name, type,
      date: newExhibit.date,
      tags: newExhibit.tags.split(",").map(t => t.trim()).filter(Boolean),
      fileUrl: url, marked: false,
    };

    // Add to deposition or library
    updateExhibits(exs => [...exs, newExhibitObj]);

    // Also add to case library if in a deposition — but only if not already there
    if (!isLibrary) {
      const library = activeCase?.library || [];
      const alreadyInLibrary = library.some(e =>
        e.name.trim().toLowerCase() === name.trim().toLowerCase()
      );
      if (!alreadyInLibrary) {
        updateCases(prev => prev.map(c =>
          c.id === activeCaseId
            ? { ...c, library: [...(c.library || []), { ...newExhibitObj }] }
            : c
        ));
        notify(`"${name}" added — also saved to case library`);
      } else {
        notify(`"${name}" added to deposition (already in case library)`);
      }
    } else {
      notify(`"${name}" added to case library`);
    }

    setNewExhibit({ name: "", type: "PDF", date: "", tags: "" });
    setShowAddExhibit(false);
  }

  function clearAnnotations() {
    if (!activeExhibitId) return;
    setAnnotations(prev => ({ ...prev, [activeExhibitId]: { strokes: [], notes: [] } }));
  }

  async function resetAllData() {
    if (!confirm("Reset all data?")) return;
    await storageDel(STORAGE_KEY); await storageDel(ANN_KEY); await storageDel(META_KEY);
    setCases(SEED_CASES); setActiveCaseId(SEED_CASES[0].id);
    setActiveDepoId("__library__"); setActiveExhibitId(null); setAnnotations({});
    notify("Reset to sample data");
  }

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && activeExhibitId) attachFile(activeExhibitId, file);
  }, [activeExhibitId, exhibits]);

  const hasAnnotations = activeExhibitId && ((annotations[activeExhibitId]?.strokes?.length || 0) + (annotations[activeExhibitId]?.notes?.length || 0)) > 0;
  const witnessUrl = window.location.href.split("#")[0] + "#witness";

  const inputStyle = { width: "100%", background: "#0A1628", border: "1px solid #1E3254", borderRadius: 6, padding: "8px 12px", color: "#E8EDF5", fontSize: 13, outline: "none", boxSizing: "border-box" };

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#0A1628", minHeight: "100vh", color: "#E8EDF5", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ background: "#0F1B2D", borderBottom: "1px solid #1E3254", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 26, height: 26, background: "#C9A84C", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, color: "#0F1B2D" }}>D</div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>DepoDesk</span>
          </div>
          {activeCase && (
            <>
              <div style={{ width: 1, height: 18, background: "#1E3254" }} />
              <span style={{ fontSize: 12, color: "#7A93B8" }}>{activeCase.name}</span>
              {activeDepo && (
                <>
                  <div style={{ fontSize: 12, color: "#2A3F58" }}>›</div>
                  <span style={{ fontSize: 12, color: "#7A93B8" }}>{activeDepo.witness}</span>
                  {activeDepo.date && <span style={{ fontSize: 11, color: "#4A6080" }}>{activeDepo.date}</span>}
                </>
              )}
              {isLibrary && <span style={{ fontSize: 11, color: "#4A6080" }}>Case Library</span>}
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {saveStatus === "saved" && <span style={{ fontSize: 10, color: "#4CAF82" }}>✓ Saved</span>}
          {sharedId && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "#0D2D1A", border: "1px solid #2A5C3A", borderRadius: 20, padding: "3px 10px", fontSize: 11, color: "#4CAF82" }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#4CAF82", animation: "pulse 1.5s infinite" }} />
              {sharedExhibit?.label} live
            </div>
          )}
          {!isLibrary && activeDepo && (
            <button onClick={() => setShowImportModal(true)} style={{ background: "transparent", border: "1px solid #1E3254", color: "#7A93B8", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>⬇ Import from Library</button>
          )}
          <button onClick={() => setShowWitnessModal(true)} style={{ background: "transparent", border: "1px solid #1E3254", color: "#7A93B8", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>👁 Witness</button>
          <button onClick={() => setShowAddExhibit(true)} style={{ background: "#C9A84C", color: "#0F1B2D", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Exhibit</button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Cases Panel */}
        <div style={{ width: 200, flexShrink: 0, background: "#0C1624", borderRight: "1px solid #1A2D47", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <CasesPanel cases={cases} activeCaseId={activeCaseId} onSelectCase={selectCase} onNewCase={addCase} onDeleteCase={deleteCase} onResetData={resetAllData} />
        </div>

        {/* Depositions Panel */}
        <div style={{ width: 200, flexShrink: 0, background: "#0E1A2E", borderRight: "1px solid #1A2D47", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <DepositionsPanel activeCase={activeCase} activeDepoId={activeDepoId} onSelectDepo={selectDepo} onNewDepo={addDepo} onDeleteDepo={deleteDepo} />
        </div>

        {/* Exhibit List */}
        <div style={{ width: 240, flexShrink: 0, background: "#0F1B2D", borderRight: "1px solid #1E3254", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 12px 6px" }}>
            <div style={{ fontSize: 10, color: "#4A6080", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 6 }}>
              {isLibrary ? "Case Library" : `${activeDepo?.witness || ""} — Exhibits`}
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ ...inputStyle, padding: "6px 10px", fontSize: 12 }} />
          </div>
          <div style={{ padding: "0 12px 6px", fontSize: 10, color: "#4A6080", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px" }}>
            {filtered.length} exhibit{filtered.length !== 1 ? "s" : ""}
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 && (
              <div style={{ padding: "20px 12px", textAlign: "center", color: "#2A3F58", fontSize: 12 }}>
                No exhibits yet.<br />
                <span style={{ color: "#C9A84C", cursor: "pointer" }} onClick={() => setShowAddExhibit(true)}>Add one →</span>
              </div>
            )}
            {filtered.map(ex => {
              const isActive = ex.id === activeExhibitId;
              const isShared = ex.id === sharedId;
              const tc = typeColors[ex.type] || typeColors.PDF;
              const annCount = (annotations[ex.id]?.strokes?.length || 0) + (annotations[ex.id]?.notes?.length || 0);
              return (
                <div key={ex.id} onClick={() => { setActiveExhibitId(ex.id); setShowAnnotations(false); setAnnTool("none"); }} style={{
                  padding: "9px 12px", borderBottom: "1px solid #1A2D47", cursor: "pointer",
                  background: isActive ? "#162540" : "transparent",
                  borderLeft: isActive ? "3px solid #C9A84C" : "3px solid transparent",
                  transition: "background 0.15s",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                    {/* Number badge — only shows when marked */}
                    <div style={{
                      width: 30, height: 30, flexShrink: 0,
                      background: isShared ? "#0D2D1A" : ex.marked ? "#131F33" : "#0A1628",
                      border: `1px solid ${isShared ? "#2A5C3A" : ex.marked ? "#C9A84C" : "#1E3254"}`,
                      borderRadius: 4,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: ex.marked ? 10 : 14, fontWeight: 800,
                      color: isShared ? "#4CAF82" : ex.marked ? "#C9A84C" : "#2A3F58",
                    }}>{ex.marked ? ex.exhibitNum : "—"}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2, flexWrap: "wrap" }}>
                        {ex.marked
                          ? <span style={{ fontSize: 10, fontWeight: 700, color: "#C9A84C" }}>{ex.label}</span>
                          : <span style={{ fontSize: 10, fontWeight: 500, color: "#4A6080", fontStyle: "italic" }}>Unmarked</span>
                        }
                        {ex.marked && <span style={{ fontSize: 9, background: "#0D2D1A", color: "#4CAF82", borderRadius: 3, padding: "1px 4px", fontWeight: 600 }}>✓</span>}
                        {isShared && <span style={{ fontSize: 9, background: "#0D2D1A", color: "#4CAF82", borderRadius: 3, padding: "1px 4px", fontWeight: 600 }}>LIVE</span>}
                        {ex.fileUrl && <span style={{ fontSize: 9, background: "#1E3A5F", color: "#7EB3E8", borderRadius: 3, padding: "1px 4px", fontWeight: 600 }}>FILE</span>}
                        {annCount > 0 && <span style={{ fontSize: 9, background: "#2D1E3A", color: "#C07EE8", borderRadius: 3, padding: "1px 4px", fontWeight: 600 }}>✏{annCount}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#C8D6E8", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ex.name}</div>
                      <div style={{ display: "flex", gap: 5, marginTop: 3 }}>
                        <span style={{ fontSize: 9, background: tc.bg, color: tc.text, borderRadius: 3, padding: "1px 5px", fontWeight: 600 }}>{ex.type}</span>
                        {ex.date && <span style={{ fontSize: 9, color: "#4A6080" }}>{ex.date}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Viewer */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}
          onDrop={onDrop} onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}>

          {activeExhibit ? (
            <>
              <div style={{ background: "#0F1B2D", borderBottom: "1px solid #1E3254", padding: "10px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 8, flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {activeExhibit.marked
                      ? <span style={{ fontSize: 11, fontWeight: 800, color: "#C9A84C", letterSpacing: "1px", textTransform: "uppercase" }}>{activeExhibit.label}</span>
                      : <span style={{ fontSize: 11, fontWeight: 600, color: "#4A6080", fontStyle: "italic" }}>Not yet marked</span>
                    }
                    {activeExhibit.marked && <span style={{ fontSize: 9, background: "#0D2D1A", color: "#4CAF82", borderRadius: 3, padding: "2px 5px", fontWeight: 700 }}>IN RECORD</span>}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#E8EDF5", marginTop: 1 }}>{activeExhibit.name}</div>
                  {activeDepo && <div style={{ fontSize: 11, color: "#4A6080", marginTop: 2 }}>{activeDepo.witness} · {activeDepo.date}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button onClick={() => { setShowAnnotations(v => !v); setAnnTool(showAnnotations ? "none" : "pen"); }} style={{
                    background: showAnnotations ? "#2D1E3A" : "transparent",
                    border: `1px solid ${showAnnotations ? "#C07EE8" : "#1E3254"}`,
                    color: showAnnotations ? "#C07EE8" : "#7A93B8",
                    borderRadius: 6, padding: "5px 11px", fontSize: 12, cursor: "pointer",
                  }}>✏️ {showAnnotations ? "Annotating" : "Annotate"}</button>
                  <input ref={attachInputRef} type="file" accept=".pdf,image/*" style={{ display: "none" }}
                    onChange={e => { attachFile(activeExhibit.id, e.target.files[0]); e.target.value = ""; }} />
                  <button onClick={() => attachInputRef.current.click()} style={{ background: "transparent", border: "1px solid #1E3254", color: "#7A93B8", borderRadius: 6, padding: "5px 11px", fontSize: 12, cursor: "pointer" }}>
                    {activeExhibit.fileUrl ? "Replace" : "Attach File"}
                  </button>
                  {!activeExhibit.marked && (
                    <button onClick={() => markExhibit(activeExhibit.id)} style={{ background: "transparent", border: "1px solid #2A5C3A", color: "#4CAF82", borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Mark</button>
                  )}
                  <button onClick={() => sharedId === activeExhibit.id ? stopSharing() : shareExhibit(activeExhibit.id)} style={{
                    background: sharedId === activeExhibit.id ? "#0D2D1A" : "#C9A84C",
                    border: sharedId === activeExhibit.id ? "1px solid #2A5C3A" : "none",
                    color: sharedId === activeExhibit.id ? "#4CAF82" : "#0F1B2D",
                    borderRadius: 6, padding: "5px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>{sharedId === activeExhibit.id ? "✓ Stop Sharing" : "Share with All"}</button>
                </div>
              </div>

              {showAnnotations && (
                <div style={{ background: "#0A1628", borderBottom: "1px solid #1E3254", padding: "5px 18px", display: "flex", alignItems: "center", gap: 8 }}>
                  <AnnotationToolbar tool={annTool} setTool={setAnnTool} color={annColor} setColor={setAnnColor} onClear={clearAnnotations} />
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "#2D1E3A", background: "#C07EE8", borderRadius: 10, padding: "2px 8px", fontWeight: 600 }}>Private</span>
                </div>
              )}

              <div style={{ flex: 1, overflow: "hidden", position: "relative", background: dragOver ? "#0D2033" : "#0A1628", transition: "background 0.15s" }}>
                {dragOver && (
                  <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,22,40,0.85)", border: "2px dashed #C9A84C", borderRadius: 8, margin: 16, pointerEvents: "none" }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>📎</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#C9A84C" }}>Drop to attach to {activeExhibit.label}</div>
                    </div>
                  </div>
                )}
                {activeExhibit.fileUrl ? (
                  <div style={{ width: "100%", height: "100%", position: "relative" }}>
                    {activeExhibit.type === "Image"
                      ? <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}><img src={activeExhibit.fileUrl} alt={activeExhibit.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /></div>
                      : <iframe src={activeExhibit.fileUrl} title={activeExhibit.name} style={{ width: "100%", height: "100%", border: "none" }} />
                    }
                    {showAnnotations && <AnnotationLayer exhibitId={activeExhibit.id} tool={annTool} color={annColor} annotations={annotations} setAnnotations={setAnnotations} />}
                  </div>
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ textAlign: "center", maxWidth: 360 }}>
                      <div style={{ display: "inline-block", border: "2px solid #C9A84C", borderRadius: 6, padding: "10px 24px", marginBottom: 24 }}>
                        <div style={{ fontSize: 9, color: "#C9A84C", fontWeight: 800, letterSpacing: "2px" }}>EXHIBIT</div>
                        <div style={{ fontSize: 44, fontWeight: 900, color: "#C9A84C", lineHeight: 1 }}>{exhibits.indexOf(activeExhibit) + 1}</div>
                        {activeDepo && <div style={{ fontSize: 9, color: "#7A93B8", marginTop: 2 }}>{activeDepo.witness}</div>}
                      </div>
                      <div style={{ border: "2px dashed #1E3254", borderRadius: 8, padding: "24px 28px", cursor: "pointer" }} onClick={() => attachInputRef.current.click()}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#C8D6E8", marginBottom: 4 }}>No file attached yet</div>
                        <div style={{ fontSize: 11, color: "#4A6080", marginBottom: 12 }}>Drop a PDF or image, or click to browse</div>
                        <div style={{ display: "inline-block", background: "#C9A84C", color: "#0F1B2D", borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 700 }}>Attach File</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
              <div style={{ width: 56, height: 56, border: "2px solid #1E3254", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                {isLibrary ? "📁" : "📋"}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#4A6080" }}>
                {exhibits.length === 0
                  ? isLibrary ? "No exhibits in the case library yet" : "No exhibits in this deposition yet"
                  : "Select an exhibit to view"}
              </div>
              {exhibits.length === 0 && (
                <button onClick={() => setShowAddExhibit(true)} style={{ background: "#C9A84C", color: "#0F1B2D", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
                  + Add {isLibrary ? "to Library" : "Exhibit"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Live Banner */}
      {sharedId && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#0D2D1A", border: "1px solid #2A5C3A", borderRadius: 8, padding: "8px 18px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.5)", zIndex: 100 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4CAF82" }} />
          <span style={{ fontSize: 12, color: "#4CAF82", fontWeight: 600 }}>{sharedExhibit?.label} — "{sharedExhibit?.name}" is live</span>
          <button onClick={stopSharing} style={{ background: "transparent", border: "1px solid #2A5C3A", color: "#4CAF82", borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Stop</button>
        </div>
      )}

      {/* Toast */}
      {notification && (
        <div style={{ position: "fixed", top: 62, right: 20, background: "#0F1B2D", border: `1px solid ${notification.color}`, borderRadius: 6, padding: "9px 14px", fontSize: 12, color: notification.color, fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,0.5)", zIndex: 200, animation: "fadeIn 0.2s ease" }}>{notification.msg}</div>
      )}

      {/* Import from Library Modal */}
      {showImportModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}>
          <div style={{ background: "#0F1B2D", border: "1px solid #1E3254", borderRadius: 10, padding: 26, width: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.6)", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Import from Case Library</div>
            <div style={{ fontSize: 12, color: "#7A93B8", marginBottom: 16 }}>Select exhibits to add to {activeDepo?.witness}'s deposition.</div>
            <ImportSelector library={activeCase?.library || []} depoExhibits={activeDepo?.exhibits || []} onImport={importFromLibrary} onClose={() => setShowImportModal(false)} />
          </div>
        </div>
      )}

      {/* Witness Modal */}
      {showWitnessModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}>
          <div style={{ background: "#0F1B2D", border: "1px solid #1E3254", borderRadius: 10, padding: 26, width: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Witness View</div>
            <div style={{ fontSize: 12, color: "#7A93B8", marginBottom: 18 }}>Share this link with participants. They'll see exhibits the moment you push them.</div>
            <div style={{ background: "#0A1628", border: "1px solid #1E3254", borderRadius: 6, padding: "9px 12px", fontSize: 11, color: "#C9A84C", fontFamily: "monospace", wordBreak: "break-all", marginBottom: 14 }}>{witnessUrl}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { navigator.clipboard?.writeText(witnessUrl); notify("Link copied!"); setShowWitnessModal(false); }} style={{ background: "#C9A84C", color: "#0F1B2D", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", flex: 1 }}>Copy Link</button>
              <button onClick={() => { window.open(witnessUrl, "_blank"); setShowWitnessModal(false); }} style={{ background: "transparent", border: "1px solid #1E3254", color: "#7A93B8", borderRadius: 6, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>Preview →</button>
              <button onClick={() => setShowWitnessModal(false)} style={{ background: "transparent", border: "1px solid #1E3254", color: "#7A93B8", borderRadius: 6, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Exhibit Modal */}
      {showAddExhibit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}>
          <div style={{ background: "#0F1B2D", border: "1px solid #1E3254", borderRadius: 10, padding: 26, width: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
              Add Exhibit {isLibrary ? "to Library" : `— ${activeDepo?.witness}`}
            </div>
            <div style={{ fontSize: 11, color: "#4A6080", marginBottom: 16 }}>
              {isLibrary ? "Library exhibits can be imported into any deposition." : "Exhibit will be added to this deposition only."}
            </div>
            <div style={{ border: `2px dashed ${modalFile ? "#4CAF82" : "#1E3254"}`, borderRadius: 8, padding: "18px 14px", textAlign: "center", marginBottom: 14, cursor: "pointer", background: modalFile ? "#0D2D1A" : "transparent" }}
              onClick={() => fileInputRef.current.click()}
              onDrop={e => { e.preventDefault(); setModalFile(e.dataTransfer.files[0]); }}
              onDragOver={e => e.preventDefault()}>
              <input ref={fileInputRef} type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={e => setModalFile(e.target.files[0])} />
              {modalFile
                ? <div><div style={{ fontSize: 18, marginBottom: 3 }}>✅</div><div style={{ fontSize: 12, color: "#4CAF82", fontWeight: 600 }}>{modalFile.name}</div></div>
                : <div><div style={{ fontSize: 22, marginBottom: 5 }}>📎</div><div style={{ fontSize: 12, color: "#7A93B8" }}>Drop PDF or image, or <span style={{ color: "#C9A84C", fontWeight: 600 }}>browse</span></div></div>
              }
            </div>
            {[{ label: "Document Name", key: "name", type: "text", placeholder: "e.g. Lease Agreement" }, { label: "Date", key: "date", type: "date" }, { label: "Tags", key: "tags", type: "text", placeholder: "contract, finance" }].map(f => (
              <div key={f.key} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#4A6080", fontWeight: 600, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.4px" }}>{f.label}</div>
                <input type={f.type} value={newExhibit[f.key]} placeholder={f.placeholder || ""} onChange={e => setNewExhibit(p => ({ ...p, [f.key]: e.target.value }))} style={inputStyle} />
              </div>
            ))}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "#4A6080", fontWeight: 600, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.4px" }}>Type</div>
              <select value={newExhibit.type} onChange={e => setNewExhibit(p => ({ ...p, type: e.target.value }))} style={inputStyle}>
                {["PDF","Email","Image","Video"].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setShowAddExhibit(false); setModalFile(null); }} style={{ background: "transparent", border: "1px solid #1E3254", color: "#7A93B8", borderRadius: 6, padding: "7px 14px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => { addExhibit(modalFile); setModalFile(null); }} style={{ background: "#C9A84C", color: "#0F1B2D", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Add Exhibit</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0A1628; }
        ::-webkit-scrollbar-thumb { background: #1E3254; border-radius: 2px; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.5); }
        select option { background: #0F1B2D; }
      `}</style>
    </div>
  );
}

// ─── Import Selector Component ───────────────────────────────────────────────
function ImportSelector({ library, depoExhibits, onImport, onClose }) {
  const existingIds = (depoExhibits || []).map(e => e.id);
  const [selected, setSelected] = useState([]);

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  return (
    <>
      <div style={{ overflowY: "auto", flex: 1, marginBottom: 16, maxHeight: 320 }}>
        {library.length === 0 && (
          <div style={{ padding: "20px", textAlign: "center", color: "#4A6080", fontSize: 13 }}>The case library is empty. Add exhibits to the library first.</div>
        )}
        {library.map(ex => {
          const already = existingIds.includes(ex.id);
          const isSelected = selected.includes(ex.id);
          return (
            <div key={ex.id} onClick={() => !already && toggle(ex.id)} style={{
              padding: "10px 14px", borderBottom: "1px solid #1A2D47",
              cursor: already ? "not-allowed" : "pointer",
              background: isSelected ? "#0D2D1A" : "transparent",
              opacity: already ? 0.4 : 1,
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                border: `2px solid ${isSelected ? "#4CAF82" : "#1E3254"}`,
                background: isSelected ? "#4CAF82" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {isSelected && <span style={{ fontSize: 11, color: "#0F1B2D", fontWeight: 900 }}>✓</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "#C8D6E8", fontWeight: 500 }}>{ex.name}</div>
                <div style={{ fontSize: 10, color: "#4A6080", marginTop: 2 }}>{ex.label} · {ex.type}{ex.date ? ` · ${ex.date}` : ""}{already ? " · already in deposition" : ""}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ background: "transparent", border: "1px solid #1E3254", color: "#7A93B8", borderRadius: 6, padding: "7px 14px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
        <button onClick={() => onImport(selected)} disabled={selected.length === 0} style={{ background: selected.length > 0 ? "#C9A84C" : "#1E3254", color: selected.length > 0 ? "#0F1B2D" : "#4A6080", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: selected.length > 0 ? "pointer" : "not-allowed" }}>
          Import {selected.length > 0 ? `${selected.length} Exhibit${selected.length !== 1 ? "s" : ""}` : ""}
        </button>
      </div>
    </>
  );
}
