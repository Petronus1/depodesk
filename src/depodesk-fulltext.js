// ============================================================
// DepoDesk — exhibit full-text extraction + search
// ============================================================
// Text is pulled out of uploaded PDFs in the browser with pdfjs (the
// same library the viewer uses — no extra dependency, no server work,
// nothing leaves Supabase) and stored in public.exhibit_text, keyed by
// the file's storage path. Counsel can then search document CONTENTS
// across a whole case, not just exhibit names and tags.
//
// Scanned exhibits have no text layer: extraction returns nothing and
// the row is stored with has_text = false, so the UI can say which
// documents were not searchable instead of silently finding nothing.
// (OCR before upload makes a scan searchable like any other PDF.)
// ============================================================

import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { supabase } from "./depodesk-supabase";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// A page of a text PDF yields far more than this; anything less is
// almost certainly a scan whose only "text" is stray OCR noise or an
// embedded label, not searchable content.
const MIN_CHARS_PER_PAGE = 12;

/**
 * Extract plain text from a PDF.
 * @param source ArrayBuffer | Uint8Array of the PDF
 * @returns { content, pageCount, hasText }
 */
// Read one page's text items.
//
// NOTE: do NOT use page.getTextContent() — internally it does
// `for await (const value of readableStream)`, and Safari does not
// implement async iteration on ReadableStream, so it throws
// "undefined is not a function (near '...value of readableStream...')".
// Reading the stream manually works in every browser.
async function readPageTextItems(page) {
  const reader = page.streamTextContent().getReader();
  const items = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value?.items) items.push(...value.items);
  }
  return items;
}

export async function extractPdfText(source) {
  const data = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const items = await readPageTextItems(page);
    pages.push(items.map(it => it.str).join(" "));
  }
  // Collapse runs of whitespace; pdfjs emits a lot of positional gaps.
  const content = pages.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return {
    content,
    pageCount: pdf.numPages,
    hasText: content.length >= MIN_CHARS_PER_PAGE * Math.max(1, pdf.numPages),
  };
}

/**
 * Extract a PDF's text and upsert it into the case's search index.
 * Best-effort: never throws, so indexing can't break an upload. Returns
 * the summary (or null if it couldn't index).
 *
 * @param caseId       Supabase cases.id (UUID) — NOT the local "case-…" id
 * @param storagePath  path returned by uploadExhibitFile
 * @param exhibitName  display name, for labeling search results
 * @param source       ArrayBuffer/Uint8Array of the PDF, or a URL to fetch
 */
export async function indexExhibitText(caseId, storagePath, exhibitName, source) {
  if (!caseId || !storagePath) return { error: "missing case or storage path" };
  try {
    const bytes = typeof source === "string"
      ? await (await fetch(source)).arrayBuffer()
      : source;
    const { content, pageCount, hasText } = await extractPdfText(bytes);
    const { error } = await supabase.from("exhibit_text").upsert({
      case_id: caseId,
      storage_path: storagePath,
      exhibit_name: exhibitName || null,
      content: hasText ? content : "",
      page_count: pageCount,
      has_text: hasText,
      indexed_at: new Date().toISOString(),
    }, { onConflict: "case_id,storage_path" });
    if (error) {
      console.error("Could not store exhibit text:", error);
      return { error: error.message || "database rejected the write" };
    }
    return { pageCount, hasText, chars: content.length };
  } catch (err) {
    // A malformed/encrypted PDF shouldn't stop counsel attaching a file.
    console.error("Text extraction failed (exhibit stays unindexed):", err);
    return { error: err?.message || String(err) };
  }
}

/**
 * Full-text search across one case's indexed exhibits.
 * @returns [{ storage_path, exhibit_name, page_count, snippet, rank }]
 */
export async function searchExhibitText(caseId, query) {
  if (!caseId || !query?.trim()) return [];
  const { data, error } = await supabase.rpc("search_exhibit_text", {
    p_case_id: caseId, p_query: query.trim(),
  });
  if (error) { console.error("Exhibit text search failed:", error); return []; }
  return data || [];
}

/**
 * Which of this case's indexed files had no text layer (scans), so the
 * UI can report what a search could not cover.
 */
export async function getUnsearchableExhibits(caseId) {
  if (!caseId) return [];
  const { data, error } = await supabase
    .from("exhibit_text")
    .select("storage_path, exhibit_name")
    .eq("case_id", caseId)
    .eq("has_text", false);
  if (error) { console.error("Could not list unsearchable exhibits:", error); return []; }
  return data || [];
}
