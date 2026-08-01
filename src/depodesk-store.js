// ============================================================
// DepoDesk — attorney-app local store + seed data
// ============================================================
// The attorney app keeps its working data (cases → depositions →
// exhibits, annotations, and UI selection) in localStorage. These are
// the keys, the JSON get/set/delete helpers, the sanitizer that strips
// transient blob URLs before persisting, and the sample seed data used
// on first run / "Reset to sample data".
// ============================================================

export const STORAGE_KEY = "depodesk-cases-v2";
export const ANN_KEY     = "depodesk-annotations-v1";
export const META_KEY    = "depodesk-meta-v2";
export const SESSION_KEY = "depodesk-active-session-v1";

export async function storageGet(key) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
export async function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export async function storageDel(key) {
  try { localStorage.removeItem(key); } catch {}
}

// Strip transient fileUrl (blob/signed URLs die with the page) before
// persisting — the durable pointer is file_path, rehydrated on select.
export function sanitizeCases(cases) {
  return cases.map(c => ({
    ...c,
    library: (c.library || []).map(e => ({ ...e, fileUrl: null })),
    depositions: (c.depositions || []).map(d => ({
      ...d,
      exhibits: (d.exhibits || []).map(e => ({ ...e, fileUrl: null })),
    })),
  }));
}

// ─── Exhibit helpers (pure — unit tested in depodesk-store.test.js) ──────────

/**
 * Does an exhibit match the exhibit-list search box (name / label / tags)?
 *
 * Every field is guarded on purpose: an UNMARKED exhibit has `label === null`
 * (a number is only assigned at mark time), and OC-ingested or older exhibits
 * may have no `tags`. An unguarded `.toLowerCase()` here previously crashed
 * the whole app as soon as anything was typed.
 */
export function matchesExhibitQuery(exhibit, query) {
  const q = (query || "").toLowerCase();
  if (!q) return true;
  const e = exhibit || {};
  return (e.name  || "").toLowerCase().includes(q)
      || (e.label || "").toLowerCase().includes(q)
      || (e.tags  || []).some(t => (t || "").toLowerCase().includes(q));
}

/**
 * Next case-wide exhibit number: one past the highest already assigned
 * anywhere in the case (library + every deposition), or 1 if none are marked.
 * Numbering is case-wide, not per-deposition, because exhibits are reused
 * across depositions in the same case.
 */
export function nextExhibitNumber(caseObj) {
  const used = [];
  (caseObj?.library || []).forEach(e => { if (e?.exhibitNum) used.push(e.exhibitNum); });
  (caseObj?.depositions || []).forEach(d =>
    (d?.exhibits || []).forEach(e => { if (e?.exhibitNum) used.push(e.exhibitNum); }));
  return used.length > 0 ? Math.max(...used) + 1 : 1;
}

/**
 * Exhibit numbers already in use in this case, excluding one exhibit
 * (used to warn before a manual renumber collides).
 */
export function usedExhibitNumbers(caseObj, exceptId) {
  const used = [];
  const collect = e => { if (e?.id !== exceptId && e?.exhibitNum) used.push(e.exhibitNum); };
  (caseObj?.library || []).forEach(collect);
  (caseObj?.depositions || []).forEach(d => (d?.exhibits || []).forEach(collect));
  return used;
}

// ─── Seed Data ───────────────────────────────────────────────────────────────
export const SEED_CASES = [
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
