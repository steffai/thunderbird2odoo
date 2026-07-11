export function buildHeaders(cfg) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: "bearer " + cfg.apikey,
  };
  if (cfg.db) headers["X-Odoo-Database"] = cfg.db;
  return headers;
}

export async function odooCall(cfg, route, params) {
  if (cfg.url == null) throw new Error("url not set");
  if (cfg.apikey == null) throw new Error("API key not set");
  const url = cfg.url + "/json/2/" + route;
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(cfg),
    body: JSON.stringify(params),
  });

  const text = await response.text();
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

export function buildUrl(cfg, model, threadId, messageId, isUnattached) {
  if (isUnattached && messageId) {
    return cfg.url + "/odoo/mail.message/" + messageId;
  }
  if (model && threadId) {
    return cfg.url + "/odoo/" + model + "/" + threadId;
  }
  return false;
}

export async function findMail(cfg, messageId) {
  // Search mail.message by Message-Id. Try including is_unattached
  // (added by mail_manual_routing); if that field doesn't exist on an
  // unmodified Odoo, retry without it.
  let results;
  try {
    results = await odooCall(cfg, "mail.message/search_read", {
      domain: [["message_id", "=", messageId]],
      fields: ["model", "res_id", "is_unattached"],
      limit: 1,
    });
  } catch (err) {
    results = await odooCall(cfg, "mail.message/search_read", {
      domain: [["message_id", "=", messageId]],
      fields: ["model", "res_id"],
      limit: 1,
    });
  }
  if (!results || results.length === 0) {
    return { status: "not_found", model: false, thread_id: false, message_id: false, is_unattached: false, url: false };
  }
  const msg = results[0];
  const isUnattached = msg.is_unattached || false;
  const url = buildUrl(cfg, msg.model, msg.res_id, msg.id, isUnattached);
  return {
    status: "found",
    model: msg.model || false,
    thread_id: msg.res_id || false,
    message_id: msg.id,
    is_unattached: isUnattached,
    url: url,
  };
}
