import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl } from "../lib/odooClient.js";

test("normalizeUrl strips trailing slash from URL", () => {
  assert.equal(normalizeUrl("https://odoo.example.com/"), "https://odoo.example.com");
});

test("normalizeUrl preserves URL without trailing slash", () => {
  assert.equal(
    normalizeUrl("https://odoo.example.com"),
    "https://odoo.example.com",
  );
});

test("normalizeUrl strips multiple trailing slashes", () => {
  assert.equal(
    normalizeUrl("https://odoo.example.com///"),
    "https://odoo.example.com",
  );
});

test("normalizeUrl joins a single path part", () => {
  assert.equal(
    normalizeUrl("https://odoo.example.com", "odoo"),
    "https://odoo.example.com/odoo",
  );
});

test("normalizeUrl joins multiple path parts", () => {
  assert.equal(
    normalizeUrl("https://odoo.example.com", "odoo", "crm.lead/42"),
    "https://odoo.example.com/odoo/crm.lead/42",
  );
});

test("normalizeUrl strips leading slash from path parts", () => {
  assert.equal(
    normalizeUrl("https://odoo.example.com", "/odoo", "/crm.lead/42"),
    "https://odoo.example.com/odoo/crm.lead/42",
  );
});

test("normalizeUrl strips trailing slash from path parts", () => {
  assert.equal(
    normalizeUrl("https://odoo.example.com", "odoo/", "crm.lead/42/"),
    "https://odoo.example.com/odoo/crm.lead/42",
  );
});

test("normalizeUrl handles base with trailing slash and parts with leading slashes", () => {
  assert.equal(
    normalizeUrl("https://odoo.example.com/", "/odoo/", "/crm.lead/42/"),
    "https://odoo.example.com/odoo/crm.lead/42",
  );
});

test("normalizeUrl returns base URL unchanged when called without parts", () => {
  assert.equal(
    normalizeUrl("https://odoo.example.com"),
    "https://odoo.example.com",
  );
});

test("normalizeUrl coerces numeric parts to strings", () => {
  assert.equal(
    normalizeUrl("https://odoo.example.com", "mail.message", 42),
    "https://odoo.example.com/mail.message/42",
  );
});

test("normalizeUrl handles mixed model string and numeric id", () => {
  assert.equal(
    normalizeUrl("https://odoo.example.com", "crm.lead", 99),
    "https://odoo.example.com/crm.lead/99",
  );
});
