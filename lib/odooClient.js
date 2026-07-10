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

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "Odoo error");

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

export async function findMail(cfg, messageId) {
  // Try find_mail first (mail_manual_routing extension)
  try {
    return await odooCall(cfg, "mail.thread/find_mail", {
      message_id: messageId,
    });
  } catch (err) {
    // find_mail not available — fall back to search_read on mail.message
    const results = await odooCall(cfg, "mail.message/search_read", {
      domain: [["message_id", "=", messageId]],
      fields: ["model", "res_id", "is_unattached"],
      limit: 1,
    });
    if (!results || results.length === 0) {
      return { found: false };
    }
    const msg = results[0];
    let url = false;
    if (msg.model && msg.res_id) {
      url = cfg.url + "/odoo/" + msg.model + "/" + msg.res_id;
    }
    return {
      found: true,
      model: msg.model || false,
      thread_id: msg.res_id || false,
      message_id: msg.id,
      is_unattached: msg.is_unattached || false,
      url: url,
    };
  }
}
