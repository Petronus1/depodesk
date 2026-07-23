// ============================================================
// DepoDesk — shared theme palette
// ============================================================
// Single source of truth for the app's colors, previously copy-pasted
// into every view. Import what a file needs:
//   import { GOLD, NAVY, DARK, BORDER, MUTED, DIM, GREEN } from "./theme";
//
// Two dark backgrounds are currently in use, so both are exported to
// keep every screen pixel-identical to its previous inline value:
//   DARK      (#0A1628) — auth, join, session panel
//   DARK_DEEP (#060E1A) — witness, opposing counsel, court reporter
// Views on DARK_DEEP import it aliased as DARK. Unify the two later if
// desired — that's a deliberate visual change, not a refactor.
// ============================================================

export const GOLD      = "#C9A84C";
export const NAVY      = "#0F1B2D";
export const DARK      = "#0A1628";
export const DARK_DEEP = "#060E1A";
export const BORDER    = "#1E3254";
export const MUTED     = "#7A93B8";
export const DIM       = "#4A6080";
export const GREEN     = "#4CAF82";
