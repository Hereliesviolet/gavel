import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_MANUAL_PDF_BASE64_CHARS } from "@/lib/manual-pdf";
import {
  ANALYSE_JSON_OVERHEAD_BYTES,
  declaredContentLengthExceeds,
  maxAnalyseRequestBodyBytes,
  parseJsonObject,
  readJsonCapped,
  readTextCapped,
  rejectCappedJson,
} from "@/lib/request-body";

describe("declaredContentLengthExceeds", () => {
  it("sperrt nur deklarierte Längen über dem Limit", () => {
    expect(declaredContentLengthExceeds("100", 99)).toBe(true);
    expect(declaredContentLengthExceeds("99", 99)).toBe(false);
    expect(declaredContentLengthExceeds(null, 1)).toBe(false);
    expect(declaredContentLengthExceeds("", 1)).toBe(false);
    expect(declaredContentLengthExceeds("nope", 1)).toBe(false);
  });
});

describe("maxAnalyseRequestBodyBytes", () => {
  it("lässt Overhead über dem PDF-Base64-Limit", () => {
    expect(maxAnalyseRequestBodyBytes()).toBe(
      MAX_MANUAL_PDF_BASE64_CHARS + ANALYSE_JSON_OVERHEAD_BYTES,
    );
  });
});

describe("readTextCapped", () => {
  it("liest unter dem Limit und bricht darüber ab", async () => {
    const ok = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"url":"x"}'));
        controller.close();
      },
    });
    await expect(readTextCapped(ok, 64)).resolves.toEqual({ ok: true, text: '{"url":"x"}' });

    const large = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abcdefghij"));
        controller.close();
      },
    });
    await expect(readTextCapped(large, 4)).resolves.toEqual({ ok: false });
    await expect(readTextCapped(null, 8)).resolves.toEqual({ ok: true, text: "" });
  });
});

describe("parseJsonObject", () => {
  it("nimmt nur flache JSON-Objekte", () => {
    expect(parseJsonObject('{"html":"<p>"}')).toEqual({ html: "<p>" });
    expect(parseJsonObject("[]")).toEqual({});
    expect(parseJsonObject("")).toEqual({});
    expect(parseJsonObject("nope")).toEqual({});
  });
});

describe("readJsonCapped", () => {
  it("liest JSON unter dem Limit und lehnt Übergröße sowie kaputtes JSON ab", async () => {
    const ok = new Request("http://gavel.test", {
      method: "POST",
      body: '{"a":1}',
    });
    await expect(readJsonCapped(ok, 64)).resolves.toEqual({ ok: true, value: { a: 1 } });

    const declared = new Request("http://gavel.test", {
      method: "POST",
      headers: { "content-length": "200" },
      body: "{}",
    });
    await expect(readJsonCapped(declared, 16)).resolves.toEqual({ ok: false, status: 413 });

    const invalid = new Request("http://gavel.test", {
      method: "POST",
      body: "nope",
    });
    await expect(readJsonCapped(invalid, 64)).resolves.toEqual({ ok: false, status: 400 });

    const rejected = rejectCappedJson({ ok: false, status: 413 });
    expect(rejected.status).toBe(413);
  });

  it("hält mutierende API-Routen am Body-Cap", () => {
    const apiRoot = path.join(__dirname, "../../app/api");
    const inboundJson = /await\s+(?:req|request)\.json\(\)/;
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const src = readFileSync(full, "utf8");
        if (inboundJson.test(src)) offenders.push(path.relative(apiRoot, full));
      }
    }
    walk(apiRoot);
    expect(offenders).toEqual([]);
  });
});
