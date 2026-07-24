// ============================================================
// DepoDesk — Attorney app side panels
// ============================================================
// The three list/selector panels of the main attorney app, split out
// of depo-exhibit-app.jsx. All are presentational: state is their own
// local form state; everything else comes in as props / callbacks.
//   - CasesPanel        — case list + "new case" form
//   - DepositionsPanel  — deposition list for the active case + library link
//   - ImportSelector    — pick library exhibits to import into a deposition
// ============================================================

import { useState } from "react";

const statusColors = {
  active:  { bg: "#0D2D1A", text: "#4CAF82", border: "#2A5C3A", label: "Active" },
  closed:  { bg: "#1A1A2E", text: "#7A93B8", border: "#1E3254", label: "Closed" },
  pending: { bg: "#2D2200", text: "#C9A84C", border: "#5C4400", label: "Pending" },
};

// ─── Cases Panel ──────────────────────────────────────────────────────────────
export function CasesPanel({ cases, activeCaseId, onSelectCase, onNewCase, onDeleteCase, onResetData }) {
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
export function DepositionsPanel({ activeCase, activeDepoId, onSelectDepo, onNewDepo, onDeleteDepo }) {
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

// ─── Import Selector ─────────────────────────────────────────────────────────
export function ImportSelector({ library, depoExhibits, onImport, onClose }) {
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
