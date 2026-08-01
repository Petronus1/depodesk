import { describe, it, expect } from "vitest";
import { normalizeExtractedText } from "./depodesk-fulltext";

// NOTE: extractPdfText itself is not unit-tested here. pdfjs is a
// browser-targeted library (it needs DOMMatrix, a worker, etc.), and more
// importantly a Node test would NOT have caught the bug that actually bit
// us — Safari's missing ReadableStream async iteration — because Node's
// support differs from Safari's. That class of bug is only caught by
// running the real app in the real browser. What IS worth pinning down is
// the decision this module makes about a document: searchable or not.

describe("normalizeExtractedText — is this document searchable?", () => {
  it("marks a normal text page as searchable", () => {
    const out = normalizeExtractedText(
      ["INDEMNIFICATION AND HOLD HARMLESS AGREEMENT between the parties"], 1);
    expect(out.hasText).toBe(true);
    expect(out.pageCount).toBe(1);
    expect(out.content).toMatch(/INDEMNIFICATION/);
  });

  it("marks a scan (no text layer at all) as NOT searchable", () => {
    // This is the common case for court exhibits before OCR. It must be
    // flagged, not silently indexed as an empty-but-searchable document —
    // otherwise a search would quietly miss it.
    const out = normalizeExtractedText([""], 1);
    expect(out.hasText).toBe(false);
    expect(out.content).toBe("");
  });

  it("marks a stray artifact (page number only) as NOT searchable", () => {
    expect(normalizeExtractedText(["3"], 1).hasText).toBe(false);
    expect(normalizeExtractedText(["  \n  "], 1).hasText).toBe(false);
  });

  it("scales the threshold with page count, so a long scan with one stray line is still flagged", () => {
    // 20 pages yielding one short line is a scan with OCR noise, not a
    // searchable document.
    const pages = Array(20).fill("");
    pages[7] = "Page 8 of 20";
    expect(normalizeExtractedText(pages, 20).hasText).toBe(false);
  });

  it("keeps every page's text, not just the first", () => {
    const out = normalizeExtractedText(
      ["Employment Agreement", "Schedule B - net thirty days"], 2);
    expect(out.content).toMatch(/Employment Agreement/);
    expect(out.content).toMatch(/net thirty days/);
    expect(out.pageCount).toBe(2);
  });
});

describe("normalizeExtractedText — snippet readability", () => {
  it("collapses the wide positional gaps pdfjs emits", () => {
    const out = normalizeExtractedText(["Clause    with     wide    gaps"], 1);
    expect(out.content).not.toMatch(/ {3,}/);
    expect(out.content).toBe("Clause with wide gaps");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeExtractedText(["   padded content here   "], 1).content)
      .toBe("padded content here");
  });

  it("does not run adjacent pages' words together", () => {
    const out = normalizeExtractedText(["end of page one", "start of page two"], 2);
    expect(out.content).not.toMatch(/onestart/);
  });

  it("handles a null/empty pages array without throwing", () => {
    expect(() => normalizeExtractedText(null, 0)).not.toThrow();
    expect(normalizeExtractedText(null, 0).hasText).toBe(false);
  });
});
