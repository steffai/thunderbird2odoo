/********************************************************************
 * Odoo Mail Importer – Thunderbird MailExtension
 * Odoo >= 19
 ********************************************************************/

import { testOdooConnection, getConnectionInfo, findMail, buildOdooUrl, searchMailMessages, countMailMessages, unifyMessageId } from "./lib/odooClient.js";
import { uploadMail, decodeRawMail } from "./lib/odooMailUpload.js";
import { getCachedResult, setCachedResult, clearAllCache, getCacheSize, getLastSync, setLastSync, CACHE_KEY } from "./lib/mailCache.js";

const MENU_ID_IMPORTER = "odoo-importer";
const MENU_ID_IMPORT = "odoo-import";
const MENU_ID_VERIFY = "odoo-verify";
const MENU_ID_SYNC = "odoo-sync";

const menuIds = new Set();
menuIds.add(MENU_ID_IMPORTER).add(MENU_ID_IMPORT).add(MENU_ID_VERIFY).add(MENU_ID_SYNC);

const EN_DASH = "\u2013";

async function cacheFoundResult(entryId, model, resId, odooMessageId) {
  const entry = { status: "found", model: model || false, resId: resId || false, odooMessageId: odooMessageId || null, parentMessageId: null };
  await setCachedResult(entryId, entry);
  return entry;
}

async function cacheParentFoundResult(entryId, parentMessageId) {
  const entry = { status: "parent_found", model: null, resId: null, odooMessageId: null, parentMessageId: parentMessageId };
  await setCachedResult(entryId, entry);
  return entry;
}

async function cacheNotFoundResult(entryId) {
  const entry = { status: "not_found", model: null, resId: null, odooMessageId: null, parentMessageId: null };
  await setCachedResult(entryId, entry);
  return entry;
}

function enrichEntry(cfg, entry) {
  if (!entry) return null;
  if (entry.odooMessageId) entry.messageUrl = buildOdooUrl(cfg, "mail.message", entry.odooMessageId);
  if (entry.model && entry.resId) entry.modelUrl = buildOdooUrl(cfg, entry.model, entry.resId);
  return entry;
}

async function enrichWithParentUrl(cfg, entry) {
  if (!entry || !entry.parentMessageId) return entry;
  const parentEntry = await getCachedResult(entry.parentMessageId);
  if (parentEntry) {
    entry.parentModelUrl = buildOdooUrl(cfg, parentEntry.model, parentEntry.resId);
    entry.parentMessageUrl = buildOdooUrl(cfg, "mail.message", parentEntry.odooMessageId);
    entry.parentUrl = entry.parentModelUrl || entry.parentMessageUrl;
  }
  return entry;
}

async function findPredecessor(cfg, pids) {
  for (const pid of pids) {
    const cached = await getCachedResult(pid);
    if (cached?.status === "found") {
      const url = buildOdooUrl(cfg, cached.model, cached.resId) || buildOdooUrl(cfg, "mail.message", cached.odooMessageId);
      return { messageId: pid, url };
    }
    const found = await findMail(cfg, pid);
    if (found.status === "found") {
      await cacheFoundResult(pid, found.model, found.resId, found.odooMessageId);
      const url = buildOdooUrl(cfg, found.model, found.resId) || buildOdooUrl(cfg, "mail.message", found.odooMessageId);
      return { messageId: pid, url };
    }
  }
  return null;
}

function notify(title, message, sticky = false) {
  console.debug(title + ": " + message);
  browser.notifications.create("thunderbird2odoo-" + Date.now(), {
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/odoo-48.png"),
    title: title,
    message: message,
    ...(sticky ? { priority: 2 } : {}),
  });
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn("clipboard write failed:", err);
    return false;
  }
}

function buildNotification(prefix, r) {
  let title = "Odoo";
  let message = "";

  switch (r.status) {
    case "ok":
    case "found":
      if (r.model && r.resId) {
        title = "Odoo – " + r.model + " " + (r.resId || "");
        message = prefix;
      } else {
        message = prefix + (r.odooMessageId ? " (message " + r.odooMessageId + ")" : "");
      }
      break;
    case "lost":
      title = "Odoo – Lost Messages";
      message = prefix + " to Lost Messages";
      break;
    case "duplicate":
      if (r.model) {
        title = "Odoo – " + r.model + " " + (r.resId || "");
      }
      message = "Email not imported: already in Odoo (duplicate)";
      break;
    case "ignored":
      message = "Email not imported: ignored by Odoo (loop detection or bounce)";
      break;
    case "not_found":
      message = "Email not found in Odoo";
      break;
    default:
      message = prefix + " (status: " + r.status + ")";
  }

  if (r.modelUrl) message += "\n" + r.modelUrl;
  if (r.messageUrl && r.messageUrl !== r.modelUrl) message += "\n" + r.messageUrl;

  return { title, message };
}

async function showResult(prefix, r, cfg, sticky = false) {
  enrichEntry(cfg, r);
  const n = buildNotification(prefix, r);
  let message = n.message;
  const url = r.modelUrl || r.messageUrl;
  if (url) {
    const copied = await copyToClipboard(url);
    if (copied) {
      message += "\nURL copied to clipboard";
    }
  }
  notify(n.title, message, sticky);
}

async function get_config() {
  return browser.storage.local.get(["url", "db", "apikey"]);
}

async function setup() {
  browser.menus.removeAll();

  const cfg = await get_config();

  if (!cfg.url || !cfg.apikey) {
    return;
  }

  const hasPermission = await browser.permissions.contains({
    origins: ["*://*/*"],
  });
  if (hasPermission) {
    try {
      await testOdooConnection(cfg);
    } catch (err) {
      console.warn(
        "setup: connection test failed, menus still created:",
        err,
      );
    }
  } else {
    console.debug(
      "setup: host permission not granted yet, skipping connection test",
    );
  }

  const icon = {
    16: "icons/odoo-16.png",
    32: "icons/odoo-32.png",
    48: "icons/odoo-48.png",
    96: "icons/odoo-96.png",
    128: "icons/odoo-128.png",
  };

  browser.menus.create({
    id: MENU_ID_IMPORTER,
    title: "Odoo Email Importer",
    contexts: ["message_list"],
    icons: icon,
  });

  browser.menus.create({
    id: "odoo-import",
    title: "Import this email",
    parentId: MENU_ID_IMPORTER,
    contexts: ["message_list"],
    icons: icon,
  });

  browser.menus.create({
    id: MENU_ID_VERIFY,
    title: "Verify",
    parentId: MENU_ID_IMPORTER,
    contexts: ["message_list"],
    icons: icon,
  });

  browser.menus.create({
    id: MENU_ID_SYNC,
    title: "Sync from Odoo",
    parentId: MENU_ID_IMPORTER,
    contexts: ["message_list"],
    icons: icon,
  });

}

browser.menus.onShown.addListener((info) => {
  if (menuIds.size === 0) return;
  const selectedCount = info.selectedMessages?.messages?.length ?? 0;
  browser.menus.update(MENU_ID_IMPORTER, { visible: selectedCount >= 1 });
  browser.menus.update(MENU_ID_IMPORT, { visible: selectedCount === 1 });
  browser.menus.update(MENU_ID_VERIFY, {
    visible: selectedCount >= 1,
    title: selectedCount > 1 ? "Verify " + selectedCount + " messages" : "Verify",
  });
  browser.menus.update(MENU_ID_SYNC, { visible: true });
  browser.menus.refresh();
});

function getMessageIdFromRaw(raw) {
  const match = raw.match(/^Message-ID:\s*<([^>]+)>/im);
  return match ? match[1] : null;
}

function extractPredecessorIds(decoded) {
  const ids = [];

  const irtMatch = decoded.match(/^In-Reply-To:\s*<([^>]+)>/im);
  if (irtMatch) {
    ids.push(irtMatch[1]);
  }

  const refsMatch = decoded.match(/^References:\s*(.+)$/im);
  if (refsMatch) {
    const refIds = refsMatch[1].match(/<[^>]+>/g);
    if (refIds) {
      for (let i = refIds.length - 1; i >= 0; i--) {
        const trimmed = unifyMessageId(refIds[i]);
        if (!ids.includes(trimmed)) {
          ids.push(trimmed);
        }
      }
    }
  }

  return ids;
}

function extractPredecessorIdsFromHeaders(headers) {
  const ids = [];
  const irt = headers["in-reply-to"];
  if (irt && irt[0]) {
    const match = irt[0].match(/<[^>]+>/);
    if (match) ids.push(unifyMessageId(match[0]));
  }
  const refs = headers["references"];
  if (refs && refs[0]) {
    const refIds = refs[0].match(/<[^>]+>/g);
    if (refIds) {
      for (let i = refIds.length - 1; i >= 0; i--) {
        const id = unifyMessageId(refIds[i]);
        if (!ids.includes(id)) ids.push(id);
      }
    }
  }
  return ids;
}

async function getHeaders(messageId) {
  const full = await messenger.messages.getFull(messageId);
  return full.headers;
}

async function showDialog(title, message, buttons = []) {
  const params = new URLSearchParams({
    title,
    message,
    buttons: JSON.stringify(buttons),
  });
  const url = browser.runtime.getURL("dialog.html?" + params);
  const win = await browser.windows.create({
    url: url,
    type: "popup",
    width: 600,
    height: 360,
  });
  let done = false;
  return new Promise((resolve) => {
    const cleanup = () => {
      if (done) return;
      done = true;
      browser.runtime.onMessage.removeListener(msgListener);
      browser.windows.onRemoved.removeListener(closeListener);
    };
    const msgListener = (msg) => {
      if (msg.action === "dialogChoice" && msg.windowId === win.id) {
        cleanup();
        resolve(msg.choice);
      }
    };
    const closeListener = (windowId) => {
      if (windowId === win.id) {
        cleanup();
        resolve(-1);
      }
    };
    browser.runtime.onMessage.addListener(msgListener);
    browser.windows.onRemoved.addListener(closeListener);
  });
}

async function importMessageById(messageId) {
  const hasPermission = await browser.permissions.contains({
    origins: ["*://*/*"],
  });
  if (!hasPermission) {
    throw new Error(
      "Host permission not granted. Open the add-on options and click 'Test connection' to grant access.",
    );
  }

  const rawMail = await messenger.messages.getRaw(messageId);
  const mid = getMessageIdFromRaw(rawMail);
  if (!mid) throw new Error("Could not extract Message-Id from email");
  console.debug("importMessageById: Message-Id=" + mid);
  const decoded = decodeRawMail(rawMail);

  const cfg = await get_config();

  // Step 1: Find email in Odoo
  const result = await findMail(cfg, mid);
  if (result.status === "found") {
    await cacheFoundResult(mid, result.model, result.resId, result.odooMessageId);
    await showResult("Email found in Odoo", result, cfg, true);
    return mid;
  }

  // Step 2: Check predecessor(s) from In-Reply-To / References
  const predecessorIds = extractPredecessorIds(decoded);
  const predFound = await findPredecessor(cfg, predecessorIds);

  if (predFound) {
    await cacheParentFoundResult(mid, predFound.messageId);
    const btnIdx = await showDialog(
      "Odoo Email Importer",
      "Predecessor email found" + (predFound.url ? " at " + predFound.url : "") + ". Import this email?",
      [{ title: "Import", value: 0 }],
    );
    if (btnIdx === 0) {
      await uploadAndShowResult(cfg, false, "Email imported", decoded, mid);
    }
    return mid;
  }

  // Step 3: No predecessor found
  await cacheNotFoundResult(mid);
  const btnIdx = await showDialog(
    "Odoo Email Importer",
    "This email and its predecessor are not in Odoo. How do you want to import it?",
    [{ title: "As Opportunity (CRM Lead)", value: 0 }, { title: "Generic", value: 1, tooltip: "Might fail on Odoo 19 without Lost Messages module, see https://github.com/joergsteffens/thunderbird2odoo" }],
  );
  if (btnIdx === 0) {
    await uploadAndShowResult(cfg, "crm.lead", "Email imported as Opportunity (CRM Lead)", decoded, mid);
  } else if (btnIdx === 1) {
    await uploadAndShowResult(cfg, false, "Email imported", decoded, mid);
  }
  return mid;
}

async function verifyMessageById(messageId) {
  const cfg = await get_config();
  const msg = await messenger.messages.get(messageId);
  const mid = unifyMessageId(msg.headerMessageId);
  if (!mid) return null;

  const cached = await getCachedResult(mid);
  console.debug("verifyMessageById: mid=" + mid + " cached=" + JSON.stringify(cached));
  if (cached?.status === "found" || cached?.status === "parent_found") {
    return cached;
  }

  const result = await findMail(cfg, mid);
  console.debug("verifyMessageById: findMail result=" + JSON.stringify(result));
  if (result.status === "found") {
    return await cacheFoundResult(mid, result.model, result.resId, result.odooMessageId);
  }

  const headers = await getHeaders(messageId);
  const predecessorIds = extractPredecessorIdsFromHeaders(headers);
  const predFound = await findPredecessor(cfg, predecessorIds);
  console.debug("verifyMessageById: predFound=" + JSON.stringify(predFound));
  if (predFound) {
    return await cacheParentFoundResult(mid, predFound.messageId);
  }

  console.debug("verifyMessageById: not found, caching as not_found");
  return await cacheNotFoundResult(mid);
}

async function uploadAndShowResult(cfg, model, prefix, decoded, messageId) {
  const rawResult = await uploadMail(cfg, decoded, model);
  console.debug("uploadAndShowResult: rawResult=" + JSON.stringify(rawResult));

  if (rawResult) {
    // message_process returned a thread_id — email was routed successfully.
    let found = null;
    if (messageId) {
      try {
        found = await findMail(cfg, messageId);
      } catch (err) {
        console.debug("uploadAndShowResult: findMail failed: " + err.message);
      }
    }
    if (found?.status === "found") {
      if (messageId) await cacheFoundResult(messageId, found.model, found.resId, found.odooMessageId);
      const entry = messageId ? await getCachedResult(messageId) : null;
      await showResult(prefix, entry || found, cfg, true);
    } else {
      // Odoo queued the mail but hasn't indexed it yet — cache with what we have
      if (messageId) await cacheFoundResult(messageId, model, rawResult, null);
      const r = { status: "found", model, resId: rawResult, odooMessageId: null };
      await showResult(prefix, r, cfg, true);
    }
  } else if (rawResult === false) {
    if (messageId) {
      try {
        const found = await findMail(cfg, messageId);
        if (found.status === "found") {
          if (messageId) await cacheFoundResult(messageId, found.model, found.resId, found.odooMessageId);
          const entry = messageId ? await getCachedResult(messageId) : null;
          await showResult("Email already in Odoo (duplicate)", entry || found, cfg, true);
          return;
        }
      } catch (err) {
        console.debug("uploadAndShowResult: findMail failed: " + err.message);
      }
    }
    if (messageId) await cacheNotFoundResult(messageId);
    notify("Odoo", "Email not imported: Odoo could not route this email to any model");
  } else {
    if (messageId) await cacheNotFoundResult(messageId);
    notify("Odoo", "Email not imported: ignored by Odoo (loop detection or bounce)");
  }
}

async function handleOdooImporter(info) {
  try {
    const message = info.selectedMessages?.messages?.[0];
    if (!message) throw new Error("Select exactly one email");
    await importMessageById(message.id);
  } catch (err) {
    notify("Odoo " + EN_DASH + " Error", err.message);
  }
}

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_ID_IMPORT) {
    await handleOdooImporter(info);
  } else if (info.menuItemId === MENU_ID_VERIFY) {
    const messages = info.selectedMessages?.messages;
    if (!messages?.length) return;
    notify("Odoo", "Verifying " + messages.length + " messages…");
    for (const msg of messages) {
      await verifyMessageById(msg.id);
    }
    if (tab?.id) {
      try {
        const displayed = await messenger.messageDisplay.getDisplayedMessage(tab.id);
        if (displayed) {
          const inSelection = messages.some(function (m) { return m.id === displayed.id; });
          if (!inSelection) await verifyMessageById(displayed.id);
        }
      } catch (err) {
        console.debug("right-click verify: error checking displayed message:", err);
      }
    }
    notify("Odoo", "Verify complete for " + messages.length + " messages");
  } else if (info.menuItemId === MENU_ID_SYNC) {
    await syncFromOdoo();
  }
  if (tab?.id) {
    browser.tabs.sendMessage(tab.id, { action: "refreshOdooStatus" });
  }
});

async function getSenderTabMessageId(sender) {
  if (!sender?.tab?.id) return null;
  const message = await messenger.messageDisplay.getDisplayedMessage(sender.tab.id);
  return message?.id ?? null;
}

async function syncFromOdoo(forceFull = false) {
  const cfg = await get_config();
  if (!cfg.url || !cfg.apikey) {
    return { ok: false, error: "Addon not configured" };
  }
  const prefs = await browser.storage.local.get(["maxAgeDays", "syncLimit"]);
  const maxAgeDays = prefs.maxAgeDays ?? 365;
  const syncLimit = prefs.syncLimit ?? 10000;

  const epoch = new Date(0);
  let since;
  if (forceFull) {
    since = maxAgeDays > 0 ? (() => { const d = new Date(); d.setDate(d.getDate() - maxAgeDays); return d; })() : epoch;
  } else {
    const lastSync = await getLastSync();
    if (lastSync) {
      since = new Date(lastSync);
      since.setDate(since.getDate() - 1);
    } else {
      since = maxAgeDays > 0 ? (() => { const d = new Date(); d.setDate(d.getDate() - maxAgeDays); return d; })() : epoch;
    }
  }
  const sinceStr = since.toISOString().replace("Z", "");

  let count = 0;
  try {
    const estimated = await countMailMessages(cfg, sinceStr);
    notify("Odoo", "Syncing from Odoo (since " + sinceStr.slice(0, 10) + "): " + estimated + " messages…");
    console.debug("syncFromOdoo: since=" + sinceStr + " limit=" + syncLimit + " estimated=" + estimated);

    const results = await searchMailMessages(cfg, sinceStr, syncLimit);
    const data = await browser.storage.local.get(CACHE_KEY);
    const cache = data[CACHE_KEY] || {};
    for (const msg of results) {
      if (!msg.message_id) continue;
      cache[unifyMessageId(String(msg.message_id))] = {
        status: "found",
        model: msg.model || false,
        resId: msg.res_id || false,
        odooMessageId: msg.id || null,
        parentMessageId: null,
      };
      count++;
    }
    const truncated = syncLimit !== 0 && results.length >= syncLimit;
    await browser.storage.local.set({ [CACHE_KEY]: cache });
    if (!truncated) await setLastSync(new Date().toISOString());
    const total = await getCacheSize();
    let msg = count + " messages retrieved from Odoo. Total cache size: " + total + ".";
    if (truncated) msg += " (truncated, not all results fetched)";
    notify("Odoo", msg);
    return { ok: true, count, truncated };
  } catch (err) {
    notify("Odoo " + EN_DASH + " Error", "Sync failed: " + err.message);
    return { ok: false, error: err.message };
  }
}

browser.runtime.onMessage.addListener(async (msg, sender) => {
  try {
    if (msg.action === "testConnection") {
      const info = await getConnectionInfo(msg.config);
      return { ok: true, info };
    }

    if (msg.action === "setup") {
      await setup();
      return { ok: true };
    }

    if (msg.action === "getCachedStatus") {
      return await getCachedResult(msg.messageId) || null;
    }

    if (msg.action === "getOdooStatus") {
      const msgId = await getSenderTabMessageId(sender);
      if (!msgId) { console.debug("getOdooStatus: no msgId"); return null; }
      const m = await messenger.messages.get(msgId);
      const mid = unifyMessageId(m.headerMessageId);
      if (!mid) { console.debug("getOdooStatus: no mid"); return null; }
      const cfg = await get_config();
      let entry = await getCachedResult(mid);
      console.debug("getOdooStatus: mid=" + mid + " cached=" + JSON.stringify(entry));
      if (!entry) {
        const headers = await getHeaders(msgId);
        const pids = extractPredecessorIdsFromHeaders(headers);
        for (const pid of pids) {
          const parentEntry = await getCachedResult(pid);
          if (parentEntry?.status === "found") {
            entry = await cacheParentFoundResult(mid, pid);
            break;
          }
        }
        if (!entry) { console.debug("getOdooStatus: no entry found"); return null; }
      }
      enrichEntry(cfg, entry);
      await enrichWithParentUrl(cfg, entry);
      console.debug("getOdooStatus: returning entry=" + JSON.stringify(entry));
      return entry;
    }

    if (msg.action === "verifyMessage") {
      const msgId = msg.messageId || await getSenderTabMessageId(sender);
      if (!msgId) return null;
      try {
        const cfg = await get_config();
        const result = await verifyMessageById(msgId);
        console.debug("verifyMessage: result=" + JSON.stringify(result));
        if (result) {
          enrichEntry(cfg, result);
          await enrichWithParentUrl(cfg, result);
          console.debug("verifyMessage: enriched=" + JSON.stringify(result));
          const url = result.modelUrl || result.messageUrl || result.parentUrl;
          if (url) result.urlCopied = await copyToClipboard(url);
        }
        return result;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    if (msg.action === "addMessage") {
      const msgId = msg.messageId || await getSenderTabMessageId(sender);
      if (!msgId) return null;
      const mid = await importMessageById(msgId);
      if (!mid) return null;
      const cfg = await get_config();
      const entry = await getCachedResult(mid);
      enrichEntry(cfg, entry);
      await enrichWithParentUrl(cfg, entry);
      entry.success = entry?.status === "found";
      const url = entry?.modelUrl || entry?.messageUrl || entry?.parentUrl;
      if (url && entry.success) entry.urlCopied = await copyToClipboard(url);
      return entry || null;
    }

    if (msg.action === "countOdooMessages") {
      const cfg = await get_config();
      if (!cfg.url || !cfg.apikey) return { ok: false, error: "Not configured" };
      const maxAgeDays = msg.maxAgeDays ?? 365;
      const since = maxAgeDays > 0 ? (() => { const d = new Date(); d.setDate(d.getDate() - maxAgeDays); return d; })() : new Date(0);
      const sinceStr = since.toISOString().replace("Z", "");
      try {
        const count = await countMailMessages(cfg, sinceStr);
        return { ok: true, count };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    if (msg.action === "clearCache") {
      await clearAllCache();
      return { ok: true };
    }

    if (msg.action === "syncFromOdoo") {
      return await syncFromOdoo();
    }


    if (msg.action === "getCacheInfo") {
      const size = await getCacheSize();
      const lastSync = await getLastSync();
      return { size, lastSync };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

async function registerDisplayScript() {
  const ns = browser.messageDisplayScripts || messenger.messageDisplayScripts;
  if (!ns) {
    console.debug("registerDisplayScript: messageDisplayScripts API not available");
    return;
  }
  try {
    await ns.register({
      js: [{ file: "displayScript.js" }],
    });
    console.debug("registerDisplayScript: registered");
  } catch (err) {
    console.debug("registerDisplayScript: failed", err);
  }
}

await setup();
await registerDisplayScript();
