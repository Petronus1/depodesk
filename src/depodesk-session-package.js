import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getExhibitFileUrl } from "./depodesk-supabase";

const encoder = new TextEncoder();

function safeName(value, fallback = "file") {
  const cleaned = String(value || fallback)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function dateStamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? "session" : date.toISOString().slice(0, 10);
}

function extensionFor(event) {
  const fromName = event.exhibit_file_name?.match(/\.[a-z0-9]{1,8}$/i)?.[0];
  if (fromName) return fromName.toLowerCase();
  if (event.exhibit_mime_type?.includes("png")) return ".png";
  if (event.exhibit_mime_type?.includes("jpeg")) return ".jpg";
  return ".pdf";
}

function wrapText(text, font, size, maxWidth) {
  const words = pdfSafe(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

// pdf-lib's built-in Helvetica font uses WinAnsi. Normalize unsupported
// characters so a participant name or smart punctuation cannot abort export.
function pdfSafe(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e]/g, "?");
}

async function makePdf(title, subtitle, sections) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageSize = [612, 792];
  const margin = 54;
  let page;
  let y;

  const newPage = () => {
    page = doc.addPage(pageSize);
    y = pageSize[1] - margin;
    page.drawText(pdfSafe(title), { x: margin, y, size: 17, font: bold, color: rgb(0.08, 0.12, 0.18) });
    y -= 23;
    page.drawText(pdfSafe(subtitle), { x: margin, y, size: 10, font: regular, color: rgb(0.3, 0.34, 0.4) });
    y -= 30;
  };

  const ensure = height => { if (y - height < margin) newPage(); };
  newPage();
  for (const section of sections) {
    ensure(32);
    page.drawText(pdfSafe(section.heading.toUpperCase()), { x: margin, y, size: 10, font: bold, color: rgb(0.15, 0.2, 0.28) });
    y -= 16;
    for (const item of section.lines) {
      const lines = wrapText(item, regular, 9, pageSize[0] - margin * 2);
      ensure(lines.length * 12 + 5);
      for (const line of lines) {
        page.drawText(line, { x: margin, y, size: 9, font: regular, color: rgb(0.08, 0.08, 0.08) });
        y -= 12;
      }
      y -= 3;
    }
    y -= 10;
  }
  return doc.save();
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" }) : "—";
}

async function buildCoverPdf(session, exhibitEvents) {
  const caseName = session.cases?.name || "Deposition";
  const lines = exhibitEvents.length
    ? exhibitEvents.map((event, index) => `${index + 1}. Exhibit ${event.exhibit_num || "—"} — ${event.exhibit_name || "Untitled"}`)
    : ["No downloadable marked exhibits were recorded for this session."];
  return makePdf("Post-Deposition Exhibit Package", `${caseName}${session.cases?.number ? ` · ${session.cases.number}` : ""}`, [
    { heading: "Session", lines: [`Started: ${formatDateTime(session.started_at)}`, `Ended: ${formatDateTime(session.ended_at)}`, `Session PIN: ${session.pin || "—"}`] },
    { heading: `Exhibit Index (${exhibitEvents.length})`, lines },
  ]);
}

async function buildAuditPdf(session, events, participants) {
  const caseName = session.cases?.name || "Deposition";
  const roster = participants.map(p => `${p.name} — ${String(p.role || "").replaceAll("_", " ")} — ${p.status}${p.email ? ` — ${p.email}` : ""}`);
  const chronology = events.map(event => {
    const exhibit = event.exhibit_num || event.exhibit_name
      ? ` — ${event.exhibit_num ? `Exhibit ${event.exhibit_num}` : "Exhibit"}${event.exhibit_name ? `, ${event.exhibit_name}` : ""}`
      : "";
    const actor = event.actor_name ? ` — ${event.actor_name}${event.actor_role ? ` (${event.actor_role.replaceAll("_", " ")})` : ""}` : "";
    return `${formatDateTime(event.created_at)} — ${event.event_type.replaceAll("_", " ")}${exhibit}${actor}${event.notes ? ` — ${event.notes}` : ""}`;
  });
  return makePdf("Deposition Session Audit Trail", `${caseName}${session.cases?.number ? ` · ${session.cases.number}` : ""}`, [
    { heading: "Session", lines: [`Started: ${formatDateTime(session.started_at)}`, `Ended: ${formatDateTime(session.ended_at)}`, `Status: ${session.is_active ? "Active" : "Ended"}`] },
    { heading: `Participants (${participants.length})`, lines: roster.length ? roster : ["None"] },
    { heading: `Chronology (${events.length} events)`, lines: chronology.length ? chronology : ["No events recorded"] },
  ]);
}

// Minimal standards-compliant ZIP writer using stored (uncompressed) entries.
// Avoids sending privileged exhibit files to a third-party service.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true); local.set(name, 30);
    locals.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); central.set(name, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return concat([...locals, ...centrals, end]);
}

export async function exportSessionPackage(session, events, participants, onProgress = () => {}) {
  const seen = new Set();
  const exhibitEvents = events
    .filter(event => event.event_type === "exhibit_marked" && event.exhibit_file_path)
    .filter(event => {
      if (seen.has(event.exhibit_file_path)) return false;
      seen.add(event.exhibit_file_path);
      return true;
    })
    .sort((a, b) => (a.exhibit_num || 0) - (b.exhibit_num || 0));

  const files = [
    { name: "00 - Cover Index.pdf", data: await buildCoverPdf(session, exhibitEvents) },
    { name: "01 - Session Audit.pdf", data: await buildAuditPdf(session, events, participants) },
  ];

  for (let index = 0; index < exhibitEvents.length; index += 1) {
    const event = exhibitEvents[index];
    onProgress(`Downloading exhibit ${index + 1} of ${exhibitEvents.length}…`);
    const url = await getExhibitFileUrl(event.exhibit_file_path);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not download Exhibit ${event.exhibit_num || index + 1}`);
    const prefix = String(event.exhibit_num || index + 1).padStart(3, "0");
    files.push({
      name: `Exhibits/${prefix} - Exhibit ${event.exhibit_num || index + 1} - ${safeName(event.exhibit_name, "Untitled")}${extensionFor(event)}`,
      data: new Uint8Array(await response.arrayBuffer()),
    });
  }

  onProgress("Building ZIP package…");
  const zip = zipStore(files);
  const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName(session.cases?.name, "Deposition")} - ${dateStamp(session.started_at)} - Exhibit Package.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return exhibitEvents.length;
}
