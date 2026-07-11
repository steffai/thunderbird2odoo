/********************************************************************
 * Odoo Mail Importer – Thunderbird MailExtension
 * Odoo >= 19
 ********************************************************************/

import { testOdooConnection, getConnectionInfo, findMail, buildUrl, searchMailMessages } from "./lib/odooClient.js";
import { uploadMail, decodeRawMail } from "./lib/odooMailUpload.js";
import { getCachedResult, setCachedResult, clearAllCache, getCacheSize, getLastSync, setLastSync } from "./lib/mailCache.js";

const MENU_ID_IMPORTER = "odoo-importer";
const MENU_ID_IMPORT = "odoo-import";
const MENU_ID_VERIFY = "odoo-verify";
const MENU_ID_SYNC = "odoo-sync";
const MENU_ID_SYNC_ALL = "odoo-sync-all";

const menuIds = new Set();
menuIds.add(MENU_ID_IMPORTER).add(MENU_ID_IMPORT).add(MENU_ID_VERIFY).add(MENU_ID_SYNC).add(MENU_ID_SYNC_ALL);

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
      if (r.is_unattached) {
        title = "Odoo – Lost Messages";
        message = prefix + " in Lost Messages";
      } else if (r.model) {
        title = "Odoo – " + r.model + " " + (r.thread_id || "");
        message = prefix;
      } else {
        message = prefix + " (thread " + (r.thread_id || "?") + ")";
      }
      break;
    case "lost":
      title = "Odoo – Lost Messages";
      message = prefix + " to Lost Messages";
      break;
    case "duplicate":
      if (r.is_unattached) {
        title = "Odoo – Lost Messages";
      } else if (r.model) {
        title = "Odoo – " + r.model + " " + (r.thread_id || "");
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

  if (r.url) {
    message += "\n" + r.url;
  } else if (r.message_id) {
    message += " (message " + r.message_id + ")";
  }

  return { title, message };
}

async function showResult(prefix, r, cfg, sticky = false) {
  if (!r.url) {
    r.url = buildUrl(cfg, r.model, r.thread_id, r.message_id, r.is_unattached);
  }
  const n = buildNotification(prefix, r);
  let message = n.message;
  if (r.url) {
    const copied = await copyToClipboard(r.url);
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
  menuIds.clear();

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

  browser.menus.create({
    id: MENU_ID_SYNC_ALL,
    title: "Sync All (clear & resync)",
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
  browser.menus.update(MENU_ID_VERIFY, { visible: selectedCount >= 1 });
  browser.menus.update(MENU_ID_SYNC, { visible: true });
  browser.menus.update(MENU_ID_SYNC_ALL, { visible: true });
  browser.menus.refresh();
});

function getMessageIdFromRaw(raw) {
  const match = raw.match(/^Message-ID:\s*<[^>]+>/im);
  return match ? match[0].replace(/^Message-ID:\s*/i, "") : null;
}

function extractPredecessorIds(decoded) {
  const ids = [];

  // In-Reply-To is the most direct parent — check it first.
  const irtMatch = decoded.match(/^In-Reply-To:\s*<[^>]+>/im);
  if (irtMatch) {
    ids.push(irtMatch[0].replace(/^In-Reply-To:\s*/i, "").trim());
  }

  // References may contain older ancestors; iterate in reverse so the
  // most recent (last) reference is checked first.
  const refsMatch = decoded.match(/^References:\s*(.+)$/im);
  if (refsMatch) {
    const refIds = refsMatch[1].match(/<[^>]+>/g);
    if (refIds) {
      for (let i = refIds.length - 1; i >= 0; i--) {
        const trimmed = refIds[i].trim();
        if (!ids.includes(trimmed)) {
          ids.push(trimmed);
        }
      }
    }
  }

  return ids;
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
    await setCachedResult(mid, {
      status: "found",
      model: result.model,
      resId: result.thread_id,
      url: result.url,
      parentMessageId: null,
    });
    await showResult("Email found in Odoo", result, cfg, true);
    return;
  }

  // Step 2: Check predecessor(s) from In-Reply-To / References
  const predecessorIds = extractPredecessorIds(decoded);
  let predFound = null;
  let predMessageId = null;
  for (const pid of predecessorIds) {
    console.debug("Checking predecessor: " + pid);
    predFound = await findMail(cfg, pid);
    if (predFound.status === "found") {
      predMessageId = pid;
      break;
    }
  }

  if (predFound?.status === "found") {
    await setCachedResult(mid, {
      status: "parent_found",
      model: null,
      resId: null,
      url: null,
      parentMessageId: predMessageId,
    });
    const url = buildUrl(cfg, predFound.model, predFound.thread_id, predFound.message_id, predFound.is_unattached);
    const btnIdx = await showDialog(
      "Odoo Email Importer",
      "Predecessor email found" + (url ? " at " + url : "") + ". Import this email?",
      [{ title: "Import", value: 0 }],
    );
    if (btnIdx === 0) {
      await uploadAndShowResult(cfg, false, "Email imported", decoded, mid);
    }
    return;
  }

  // Step 3: No predecessor found
  await setCachedResult(mid, {
    status: "not_found",
    model: null,
    resId: null,
    url: null,
    parentMessageId: null,
  });
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
}

async function verifyMessageById(messageId) {
  const cfg = await get_config();
  const raw = await messenger.messages.getRaw(messageId);
  const mid = getMessageIdFromRaw(raw);
  if (!mid) return null;

  const result = await findMail(cfg, mid);
  if (result.status === "found") {
    const entry = {
      status: "found",
      model: result.model,
      resId: result.thread_id,
      url: result.url,
      parentMessageId: null,
    };
    await setCachedResult(mid, entry);
    return entry;
  }

  const predecessorIds = extractPredecessorIds(decoded);
  for (const pid of predecessorIds) {
    const predFound = await findMail(cfg, pid);
    if (predFound.status === "found") {
      const entry = {
        status: "parent_found",
        model: null,
        resId: null,
        url: null,
        parentMessageId: pid,
      };
      await setCachedResult(mid, entry);
      return entry;
    }
  }

  const entry = {
    status: "not_found",
    model: null,
    resId: null,
    url: null,
    parentMessageId: null,
  };
  await setCachedResult(mid, entry);
  return entry;
}

async function uploadAndShowResult(cfg, model, prefix, decoded, messageId) {
  const rawResult = await uploadMail(cfg, decoded, model);
  console.debug("uploadAndShowResult: rawResult=" + JSON.stringify(rawResult));

  function cacheFound(found) {
    if (!messageId) return;
    setCachedResult(messageId, {
      status: "found",
      model: found.model || false,
      resId: found.thread_id || false,
      url: found.url || false,
      parentMessageId: null,
    });
  }

  function cacheNotFound() {
    if (!messageId) return;
    setCachedResult(messageId, {
      status: "not_found",
      model: null,
      resId: null,
      url: null,
      parentMessageId: null,
    });
  }

  if (rawResult) {
    // message_process returned a thread_id — email was routed successfully.
    if (messageId) {
      try {
        const found = await findMail(cfg, messageId);
        if (found.status === "found") {
          cacheFound(found);
          await showResult(prefix, found, cfg, true);
          return;
        }
      } catch (err) {
        console.debug("uploadAndShowResult: findMail failed: " + err.message);
      }
    }
    // Fallback notification without URL
    notify("Odoo", prefix + " (" + (model ? model + " " : "thread ") + rawResult + ")");
  } else if (rawResult === false) {
    if (messageId) {
      try {
        const found = await findMail(cfg, messageId);
        if (found.status === "found") {
          cacheFound(found);
          if (found.is_unattached) {
            await showResult(prefix, found, cfg, true);
          } else {
            await showResult("Email already in Odoo (duplicate)", found, cfg, true);
          }
          return;
        }
      } catch (err) {
        console.debug("uploadAndShowResult: findMail failed: " + err.message);
      }
    }
    cacheNotFound();
    notify("Odoo", "Email not imported: Odoo could not route this email to any model");
  } else {
    cacheNotFound();
    notify("Odoo", "Email not imported: ignored by Odoo (loop detection or bounce)");
  }
}

async function handleOdooImporter(info) {
  try {
    const message = info.selectedMessages?.messages?.[0];
    if (!message) throw new Error("Select exactly one email");
    await importMessageById(message.id);
  } catch (err) {
    notify("Odoo \u2013 Error", err.message);
  }
}

browser.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId === MENU_ID_IMPORT) {
    await handleOdooImporter(info);
  } else if (info.menuItemId === MENU_ID_VERIFY) {
    const messages = info.selectedMessages?.messages;
    if (!messages?.length) return;
    for (const msg of messages) {
      await verifyMessageById(msg.id);
    }
  } else if (info.menuItemId === MENU_ID_SYNC) {
    await syncFromOdoo();
  } else if (info.menuItemId === MENU_ID_SYNC_ALL) {
    await clearAllCache();
    await syncFromOdoo();
  }
});

async function getSenderTabMessageId(sender) {
  if (!sender?.tab?.id) return null;
  const message = await messenger.messageDisplay.getDisplayedMessage(sender.tab.id);
  return message?.id ?? null;
}

async function syncFromOdoo() {
  const cfg = await get_config();
  if (!cfg.url || !cfg.apikey) {
    notify("Odoo", "Configure the addon in Options first");
    return;
  }
  const prefs = await browser.storage.local.get(["maxAgeDays", "syncLimit"]);
  const maxAgeDays = prefs.maxAgeDays ?? 365;
  const syncLimit = prefs.syncLimit ?? 10000;

  const lastSync = await getLastSync();
  let since;
  if (lastSync) {
    since = new Date(lastSync);
    since.setDate(since.getDate() - 1);
  } else {
    since = new Date();
    since.setDate(since.getDate() - maxAgeDays);
  }
  const sinceStr = since.toISOString();

  notify("Odoo", "Syncing from Odoo (since " + sinceStr.slice(0, 10) + ")…");
  console.debug("syncFromOdoo: since=" + sinceStr + " limit=" + syncLimit);

  let count = 0;
  try {
    const results = await searchMailMessages(cfg, sinceStr, syncLimit);
    for (const msg of results) {
      if (!msg.message_id) continue;
      const url = buildUrl(cfg, msg.model, msg.res_id, msg.id, msg.is_unattached);
      await setCachedResult(msg.message_id, {
        status: "found",
        model: msg.model || false,
        resId: msg.res_id || false,
        url: url || false,
        parentMessageId: null,
      });
      count++;
    }
    await setLastSync(new Date().toISOString());
    notify("Odoo", "Sync complete: " + count + " messages cached");
  } catch (err) {
    notify("Odoo \u2013 Error", "Sync failed: " + err.message);
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
      const entry = await getCachedResult(msg.messageId);
      if (!entry) return null;
      if (entry.parentMessageId) {
        const parentEntry = await getCachedResult(entry.parentMessageId);
        if (parentEntry) {
          entry.parentUrl = parentEntry.url;
        }
      }
      return entry;
    }

    if (msg.action === "getOdooStatus") {
      const msgId = await getSenderTabMessageId(sender);
      if (!msgId) return null;
      const raw = await messenger.messages.getRaw(msgId);
      const mid = getMessageIdFromRaw(raw);
      if (!mid) return null;
      let entry = await getCachedResult(mid);
      if (!entry) {
        const pids = extractPredecessorIds(raw);
        for (const pid of pids) {
          const parentEntry = await getCachedResult(pid);
          if (parentEntry) {
            entry = {
              status: "parent_found",
              model: null,
              resId: null,
              url: null,
              parentMessageId: pid,
              parentUrl: parentEntry.url,
            };
            await setCachedResult(mid, entry);
            break;
          }
        }
        if (!entry) return null;
      }
      if (entry.parentMessageId) {
        const parentEntry = await getCachedResult(entry.parentMessageId);
        if (parentEntry) entry.parentUrl = parentEntry.url;
      }
      return entry;
    }

    if (msg.action === "verifyMessage") {
      const msgId = msg.messageId || await getSenderTabMessageId(sender);
      if (!msgId) return null;
      const result = await verifyMessageById(msgId);
      if (result) {
        if (result.parentMessageId) {
          const parentEntry = await getCachedResult(result.parentMessageId);
          if (parentEntry) result.parentUrl = parentEntry.url;
        }
        const statusLabel = result.status === "found" ? "found in Odoo" :
          result.status === "parent_found" ? "predecessor found" : "not found";
        notify("Odoo \u2013 Status", "Verification complete: " + statusLabel);
      }
      return result;
    }

    if (msg.action === "addMessage") {
      const msgId = msg.messageId || await getSenderTabMessageId(sender);
      if (!msgId) return null;
      await importMessageById(msgId);
      return await verifyMessageById(msgId);
    }

    if (msg.action === "clearCache") {
      await clearAllCache();
      return { ok: true };
    }

    if (msg.action === "syncFromOdoo") {
      await syncFromOdoo();
      return { ok: true };
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
