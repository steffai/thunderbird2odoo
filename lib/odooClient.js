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

export async function odooCall(cfg, route, params, { timeoutMs = 30000 } = {}) {
  if (cfg.url == null) throw new Error("url not set");
  if (cfg.apikey == null) throw new Error("API key not set");
  const url = cfg.url + "/json/2/" + route;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(cfg),
      body: JSON.stringify(params),
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
    const msg = data.error?.data?.message || data.error?.message || text.slice(0, 500) || `HTTP ${response.status}`;
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

export async function countMailMessages(cfg, since) {
  const domain = [["message_id", "!=", false], ["date", ">=", since]];
  const count = await odooCall(cfg, "mail.message/search_count", { domain });
  console.debug("countMailMessages: since=" + since + " count=" + count);
  return count;
}

export async function searchMailMessages(cfg, since, limit = 10000) {
  const params = {
    domain: [["message_id", "!=", false], ["date", ">=", since]],
    fields: ["message_id", "date", "model", "res_id"],
  };
  if (limit) params.limit = limit;
  console.debug("searchMailMessages: url=" + cfg.url + "/json/2/mail.message/search_read" + " params=" + JSON.stringify(params));
  const results = await odooCall(cfg, "mail.message/search_read", params);
  return results || [];
}

export async function findMail(cfg, messageId) {
  const clean = unifyMessageId(messageId);
  const results = await odooCall(cfg, "mail.message/search_read", {
    domain: ["|", ["message_id", "=", clean], ["message_id", "=", "<" + clean + ">"]],
    fields: ["model", "res_id"],
    limit: 1,
  });
  if (!results || results.length === 0) {
    return { status: "not_found", model: false, resId: false, odooMessageId: null };
  }
  const msg = results[0];
  return {
    status: "found",
    model: msg.model || false,
    resId: msg.res_id || false,
    odooMessageId: msg.id,
  };
}
