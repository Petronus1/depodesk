// ============================================================
// DepoDesk — Exhibit stamping
// ============================================================
// Burns a classic court-reporter exhibit sticker onto the first
// page of a PDF: bright yellow, black border, "EXHIBIT" over a
// large bold number, bottom-right. Deliberately carries no date
// or caption — exhibits are numbered case-wide and reused across
// depositions in the same case, so the stamp must stay valid for
// the life of the case. Runs entirely client-side via pdf-lib.
//
// Limitation: the stamp is drawn in unrotated page coordinates;
// on pages with /Rotate 90/180/270 it may appear along a
// different edge. Fine for v1 — the viewer has a rotate control.
// ============================================================

import { PDFDocument, StandardFonts, rgb, LineCapStyle } from "pdf-lib";

/**
 * @param bytes   ArrayBuffer | Uint8Array of the source PDF
 * @param number  case-wide exhibit number, e.g. 12
 * @returns Uint8Array of the stamped PDF
 */
export async function stampPdf(bytes, { number }) {
  const doc  = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.getPage(0);
  const { width } = page.getSize();

  const word     = "EXHIBIT";
  const numText  = String(number);
  const wordSize = 13;
  const numSize  = 22;
  const pad = 10, gap = 4, margin = 24;

  const innerW = Math.max(
    bold.widthOfTextAtSize(word, wordSize),
    bold.widthOfTextAtSize(numText, numSize)
  );
  const boxW = innerW + pad * 2;
  const boxH = wordSize + numSize + gap + pad * 2;
  const x = width - boxW - margin;
  const y = margin;

  page.drawRectangle({
    x, y, width: boxW, height: boxH,
    color: rgb(1, 0.92, 0.23),
    borderColor: rgb(0.1, 0.1, 0.1),
    borderWidth: 2,
  });
  page.drawText(word, {
    x: x + (boxW - bold.widthOfTextAtSize(word, wordSize)) / 2,
    y: y + boxH - pad - wordSize,
    size: wordSize, font: bold, color: rgb(0.08, 0.08, 0.08),
  });
  page.drawText(numText, {
    x: x + (boxW - bold.widthOfTextAtSize(numText, numSize)) / 2,
    y: y + pad,
    size: numSize, font: bold, color: rgb(0.08, 0.08, 0.08),
  });

  return doc.save();
}

/**
 * Burn witness markup strokes into a PDF (used when counsel saves a
 * witness markup session). Strokes carry page-normalized points
 * (0..1, origin top-left of the rendered page) — the same space the
 * MarkupCanvas overlay records in. Assumes unrotated pages (v1).
 *
 * @param bytes    ArrayBuffer | Uint8Array of the source PDF
 * @param strokes  [{ page, pts: [{x, y}], color? }]
 * @returns Uint8Array of the flattened PDF
 */
export async function flattenMarkup(bytes, strokes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const red = rgb(0.87, 0.07, 0.07);
  for (const s of strokes) {
    const pageIndex = (s.page || 1) - 1;
    if (pageIndex < 0 || pageIndex >= doc.getPageCount()) continue;
    const page = doc.getPage(pageIndex);
    const { width, height } = page.getSize();
    for (let i = 1; i < s.pts.length; i++) {
      page.drawLine({
        start: { x: s.pts[i - 1].x * width, y: height - s.pts[i - 1].y * height },
        end:   { x: s.pts[i].x     * width, y: height - s.pts[i].y     * height },
        thickness: 2,
        color: red,
        lineCap: LineCapStyle.Round,
      });
    }
  }
  return doc.save();
}
