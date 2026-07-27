// ============================================================
// DepoDesk — case-wide content-search results panel
// ============================================================
// Presentational. The orchestration (running the search, resolving a
// hit's storage_path back to a local exhibit, and backfilling old
// uploads) lives in depo-exhibit-app.jsx; this renders what it finds.
//
// Hits come from search_exhibit_text: { storage_path, exhibit_name,
// page_count, snippet, rank }. `snippet` wraps matches in « … »
// (ts_headline StartSel/StopSel); highlightSnippet turns those into
// <mark>s. App enriches each hit with `.loc` = where the exhibit lives
// locally (or null if it isn't in this browser's state).
// ============================================================

import { GOLD, NAVY, DARK, BORDER, MUTED, DIM, GREEN } from "./theme";

// Turn a « … »-delimited headline into React nodes with highlighted hits.
export function highlightSnippet(snippet) {
  if (!snippet) return null;
  const out = [];
  const re = /«([^»]*)»/g;
  let last = 0, m, key = 0;
  while ((m = re.exec(snippet)) !== null) {
    if (m.index > last) out.push(snippet.slice(last, m.index));
    out.push(
      <mark key={key++} style={{ background: "rgba(201,168,76,0.28)", color: "#F0E4C4", borderRadius: 2, padding: "0 1px" }}>
        {m[1]}
      </mark>
    );
    last = m.index + m[0].length;
  }
  if (last < snippet.length) out.push(snippet.slice(last));
  return out;
}

export default function SearchResults({
  query, loading, results,
  onOpen,                    // (loc) => void
  unsearchableCount = 0,     // indexed scans with no text layer
  backfill,                  // null | { pending, running, done, total }
  onBackfill,                // () => void
}) {
  const wrap = { overflowY: "auto", flex: 1 };
  const muted = (text) => (
    <div style={{ padding: "20px 12px", textAlign: "center", color: "#2A3F58", fontSize: 12, lineHeight: 1.5 }}>{text}</div>
  );

  const pendingBanner = backfill?.running ? (
    <div style={{ padding: "8px 12px", fontSize: 11, color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
      Indexing older exhibits… {backfill.done}/{backfill.total}
    </div>
  ) : backfill?.pending > 0 ? (
    <div style={{ padding: "8px 12px", borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: 11, color: DIM, marginBottom: 5 }}>
        {backfill.pending} older exhibit{backfill.pending !== 1 ? "s were" : " was"} uploaded before search
        existed and {backfill.pending !== 1 ? "aren't" : "isn't"} indexed yet.
      </div>
      <button onClick={onBackfill} style={{
        background: "transparent", border: `1px solid ${GOLD}`, color: GOLD, borderRadius: 5,
        padding: "4px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
      }}>Index {backfill.pending} for search</button>
    </div>
  ) : null;

  let body;
  if (loading) {
    body = muted("Searching…");
  } else if (!query.trim()) {
    body = muted(<>Search the full text of every<br />uploaded exhibit in this case.</>);
  } else if (results.length === 0) {
    body = muted(<>No matches for “{query.trim()}”.{unsearchableCount > 0 && <><br /><span style={{ color: GOLD }}>{unsearchableCount} scanned exhibit{unsearchableCount !== 1 ? "s" : ""}</span> couldn’t be text-searched.</>}</>);
  } else {
    body = (
      <>
        {results.map((r, i) => {
          const loc = r.loc;
          const clickable = !!loc;
          return (
            <div key={r.storage_path + i}
              onClick={() => clickable && onOpen(loc)}
              title={clickable ? "Open this exhibit" : "This exhibit isn’t loaded in this view"}
              style={{
                padding: "9px 12px", borderBottom: "1px solid #1A2D47",
                cursor: clickable ? "pointer" : "default", opacity: clickable ? 1 : 0.6,
              }}
              onMouseEnter={e => { if (clickable) e.currentTarget.style.background = "#162540"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                {loc?.marked && <span style={{ fontSize: 9, fontWeight: 700, color: GOLD }}>Exhibit {loc.exhibitNum}</span>}
                <span style={{ fontSize: 12, fontWeight: 600, color: "#C8D6E8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>
                  {r.exhibit_name || "Untitled"}
                </span>
              </div>
              <div style={{ fontSize: 10, color: DIM, marginBottom: 4 }}>
                {loc?.locationLabel || "Not in this view"}{r.page_count ? ` · ${r.page_count} pg` : ""}
              </div>
              <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.5, wordBreak: "break-word" }}>
                {highlightSnippet(r.snippet)}
              </div>
            </div>
          );
        })}
        {unsearchableCount > 0 && (
          <div style={{ padding: "10px 12px", fontSize: 10, color: DIM, borderTop: `1px solid ${BORDER}` }}>
            <span style={{ color: GOLD }}>Note:</span> {unsearchableCount} scanned exhibit{unsearchableCount !== 1 ? "s" : ""} in
            this case {unsearchableCount !== 1 ? "have" : "has"} no text layer and {unsearchableCount !== 1 ? "aren’t" : "isn’t"}
            {" "}covered by this search. OCR before upload to include {unsearchableCount !== 1 ? "them" : "it"}.
          </div>
        )}
      </>
    );
  }

  return (
    <div style={wrap}>
      {pendingBanner}
      {body}
    </div>
  );
}
