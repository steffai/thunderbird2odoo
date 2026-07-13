export function unifyMessageId(mid) {
  if (!mid) return mid;
  return mid.replace(/^<|>$/g, "");
}

export function buildHeaders(cfg) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: "bearer " + cfg.apikey,
  };
  if (cfg.db) headers["X-Odoo-Database"] = cfg.db;
  return headers;
}

export function truncateForLog(obj, maxLen = 80) {
  return JSON.stringify(obj, function (key, value) {
    return typeof value === "string" && value.length > maxLen
      ? value.slice(0, maxLen) + "…"
      : value;
  });
}

export async function odooCall(cfg, route, params, { timeoutMs = 30000 } = {}) {
  if (cfg.url == null) throw new Error("url not set");
  if (cfg.apikey == null) throw new Error("API key not set");
  const url = normalizeBaseUrl(cfg.url) + "/json/2/" + route;
  console.debug("odooCall: " + route + "(" + truncateForLog(params) + ")");
  const body = JSON.stringify(params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(cfg),
      body: body,
      signal: controller.signal,
    });
    const text = await response.text();
    return parseResponse(response, text);
  } finally {
    clearTimeout(timer);
  }
}

function parseResponse(response, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  if (!response.ok || data.error) {
    const msg =
      data.error?.data?.message ||
      data.error?.message ||
      text.slice(0, 500) ||
      `HTTP ${response.status}`;
    throw new Error(msg);
  }

  return data;
}

export async function testOdooConnection(cfg) {
  const context = await odooCall(cfg, "res.users/context_get", {});
  return context;
}

export async function getConnectionInfo(cfg) {
  // context_get returns { uid, lang, tz, ... }
  const context = await odooCall(cfg, "res.users/context_get", {});
  const uid = context.uid;

  // get the user's login and display name
  let userInfo = null;
  try {
    const users = await odooCall(cfg, "res.users/read", {
      ids: [uid],
      fields: ["login", "name"],
    });
    userInfo = users?.[0] ?? null;
  } catch (err) {
    console.debug("getConnectionInfo: could not read user info:", err);
  }

  return { uid, userInfo, context };
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

export function buildOdooUrl(cfg, model, id) {
  if (!model || !id) return null;
  return normalizeBaseUrl(cfg.url) + "/odoo/" + model + "/" + id;
}

function toOdooDate(d) {
  return d instanceof Date ? d.toISOString().replace("Z", "") : d;
}

function buildMailDomain(since) {
  const domain = [["message_id", "!=", false]];
  if (since) domain.push(["date", ">=", toOdooDate(since)]);
  return domain;
}

export async function countMailMessages(cfg, since) {
  return await odooCall(cfg, "mail.message/search_count", {
    domain: buildMailDomain(since),
  });
}

export async function searchMailMessages(cfg, since, limit = 10000) {
  const params = {
    domain: buildMailDomain(since),
    fields: ["message_id", "date", "model", "res_id"],
  };
  if (limit) params.limit = limit;
  const results = await odooCall(cfg, "mail.message/search_read", params);
  return results || [];
}

export async function findMails(cfg, messageIds) {
  if (!messageIds || messageIds.length === 0) return {};
  const cleanIds = messageIds.map(unifyMessageId);
  const results = await odooCall(cfg, "mail.message/search_read", {
    domain: [
      [
        "message_id",
        "in",
        [...cleanIds, ...cleanIds.map((id) => "<" + id + ">")],
      ],
    ],
    fields: ["message_id", "model", "res_id"],
  });
  const byId = {};
  for (const r of results || []) {
    const mid = unifyMessageId(r.message_id);
    if (mid && !byId[mid]) {
      byId[mid] = {
        status: "found",
        model: r.model || false,
        resId: r.res_id || false,
        odooMessageId: r.id,
      };
    }
  }
  return byId;
}

export async function findMail(cfg, messageId) {
  const clean = unifyMessageId(messageId);
  const results = await findMails(cfg, [messageId]);
  return (
    results[clean] || {
      status: "not_found",
      model: false,
      resId: false,
      odooMessageId: null,
    }
  );
}
