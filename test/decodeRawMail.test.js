import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeRawMail } from "../lib/odooMailUpload.js";

// helper: encode a JS string to UTF-8 and return its "binary string"
// representation, mirroring what messenger.messages.getRaw() yields.
function toBinaryString(str, encoding = "utf-8") {
  if (encoding === "utf-8") {
    const bytes = new TextEncoder().encode(str);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
  // raw single-byte latin-1 / iso-8859-1
  let s = "";
  for (const ch of str) s += String.fromCharCode(ch.charCodeAt(0));
  return s;
}

test("decodeRawMail decodes UTF-8 binary string back to the original text", () => {
  const original = "Müller – Büro: 25€";
  const raw = toBinaryString(original);
  assert.notEqual(raw, original); // sanity: raw is mojibake
  assert.equal(decodeRawMail(raw), original);
});

test("decodeRawMail preserves CRLF line breaks in UTF-8 messages", () => {
  const original = "Subject: Hello\r\nFrom: a@b.de\r\n\r\nBody üäö\r\n";
  const raw = toBinaryString(original);
  const decoded = decodeRawMail(raw);
  assert.equal(decoded, original);
});

test("decodeRawMail handles cyrillic UTF-8", () => {
  const original = "Привет, мир!"; // Hello world
  const raw = toBinaryString(original);
  assert.equal(decodeRawMail(raw), original);
});

test("decodeRawMail passes ASCII through unchanged", () => {
  const raw = "From: a@b.de\r\nSubject: plain ascii\r\n\r\nhello\r\n";
  assert.equal(decodeRawMail(raw), raw);
});

test("decodeRawMail falls back to latin-1 for non-UTF-8 bytes", () => {
  // 0xE9 is 'é' in ISO-8859-1 but not valid as a standalone UTF-8 byte.
  const raw = toBinaryString("eée", "latin-1");
  assert.equal(raw.charCodeAt(1), 0xe9);
  // fallback returns the original binary string byte-for-byte
  assert.equal(decodeRawMail(raw), raw);
});

test("decodeRawMail exposes mojibake-free text through JSON.stringify", () => {
  const original = "Universität";
  const raw = toBinaryString(original);
  const decoded = decodeRawMail(raw);
  // The whole point of the fix: JSON round-trip must contain the real chars.
  assert.equal(JSON.stringify(decoded), '"Universität"');
  assert.ok(
    !/Ã/.test(JSON.stringify(decoded)),
    "decoded text must not contain mojibake",
  );
});
