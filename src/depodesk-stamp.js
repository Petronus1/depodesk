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

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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
