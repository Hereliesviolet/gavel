import { NextResponse } from "next/server";
import { MAX_MANUAL_PDF_BASE64_CHARS } from "@/lib/manual-pdf";

export const MUTATION_JSON_MAX_BYTES = 64 * 1024;
export const CRON_JSON_MAX_BYTES = 256 * 1024;

export const ANALYSE_JSON_OVERHEAD_BYTES = 64 * 1024;

export function maxAnalyseRequestBodyBytes(
  maxPdfBase64Chars = MAX_MANUAL_PDF_BASE64_CHARS,
  overheadBytes = ANALYSE_JSON_OVERHEAD_BYTES,
): number {
  return maxPdfBase64Chars + overheadBytes;
}

export function declaredContentLengthExceeds(
  contentLength: string | null | undefined,
  maxBytes: number,
): boolean {
  if (contentLength == null || contentLength === "") return false;
  const n = Number(contentLength);
  return Number.isFinite(n) && n > maxBytes;
}

export async function readTextCapped(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  if (!stream) return { ok: true, text: "" };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

export function parseJsonObject(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type CappedJsonResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413 };

export async function readJsonCapped(
  req: Request,
  maxBytes = MUTATION_JSON_MAX_BYTES,
): Promise<CappedJsonResult> {
  if (declaredContentLengthExceeds(req.headers.get("content-length"), maxBytes)) {
    return { ok: false, status: 413 };
  }
  const raw = await readTextCapped(req.body, maxBytes);
  if (!raw.ok) return { ok: false, status: 413 };
  if (!raw.text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(raw.text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

export function rejectCappedJson(
  result: Extract<CappedJsonResult, { ok: false }>,
  invalidMessage = "Ungültige Anfrage",
): NextResponse {
  return NextResponse.json(
    { error: result.status === 413 ? "Anfrage ist zu groß" : invalidMessage },
    { status: result.status },
  );
}
