export const MAX_MANUAL_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_MANUAL_PDF_BASE64_CHARS = Math.ceil((MAX_MANUAL_PDF_BYTES * 4) / 3);
const PDF_MAGIC = Buffer.from("%PDF");
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

export type ManualPdfResult = { ok: true; bytes: Buffer } | { ok: false; error: string };

export function decodeManualPdfBase64(raw: string): ManualPdfResult {
  const normalized = raw.replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !BASE64_BODY.test(normalized)) {
    return { ok: false, error: "PDF-Datei konnte nicht gelesen werden (ungültige Kodierung)" };
  }
  if (normalized.length > MAX_MANUAL_PDF_BASE64_CHARS) {
    return { ok: false, error: "PDF-Datei ist zu groß (Limit 15 MB)" };
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length > MAX_MANUAL_PDF_BYTES) {
    return { ok: false, error: "PDF-Datei ist zu groß (Limit 15 MB)" };
  }
  if (bytes.length < PDF_MAGIC.length || !bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    return { ok: false, error: "Die Datei ist kein gültiges PDF" };
  }
  return { ok: true, bytes };
}
