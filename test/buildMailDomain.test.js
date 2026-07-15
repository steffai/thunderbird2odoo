import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMailDomain } from "../lib/odooClient.js";

test("buildMailDomain includes message_id, is_internal, and notification conditions", () => {
  const domain = buildMailDomain(null, 1);
  assert.deepEqual(domain, [
    "&",
      "&",
        ["message_id", "!=", false],
        ["is_internal", "=", false],
    "|",
      ["message_type", "!=", "notification"],
      "&",
        ["message_type", "=", "notification"],
        ["subtype_id", "=", 1],
  ]);
});

test("buildMailDomain does not include date condition when since is null", () => {
  const domain = buildMailDomain(null, 5);
  assert.equal(domain.length, 9);
  assert.ok(!domain.some((c) => Array.isArray(c) && c[0] === "date"));
});

test("buildMailDomain includes date condition when since is provided", () => {
  const since = new Date("2025-01-01T00:00:00Z");
  const domain = buildMailDomain(since, 2);
  assert.equal(domain.length, 10);
  assert.ok(domain.some((c) => Array.isArray(c) && c[0] === "date"));
  const dateCond = domain.find((c) => Array.isArray(c) && c[0] === "date");
  assert.equal(dateCond[1], ">=");
  assert.equal(dateCond[2], "2025-01-01T00:00:00.000");
});

test("buildMailDomain accepts custom discussionSubtypeId", () => {
  const domain = buildMailDomain(null, 42);
  const notificationSubtype = domain.find(
    (c) => Array.isArray(c) && c[0] === "subtype_id",
  );
  assert.equal(notificationSubtype[2], 42);
});
