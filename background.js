/********************************************************************
 * Odoo Mail Importer – Thunderbird MailExtension
 * Odoo >= 19
 ********************************************************************/

import { testOdooConnection, getConnectionInfo, findMail, buildUrl } from "./lib/odooClient.js";
import { uploadMail, decodeRawMail } from "./lib/odooMailUpload.js";

const MENU_ID_IMPORTER = "odoo-importer";

const menuIds = new Set();
menuIds.add(MENU_ID_IMPORTER);

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

  browser.menus.create({
    id: MENU_ID_IMPORTER,
    title: "Odoo Email Importer",
    contexts: ["message_list"],
    icons: {
      16: "icons/odoo-16.png",
      32: "icons/odoo-32.png",
      48: "icons/odoo-48.png",
      96: "icons/odoo-96.png",
      128: "icons/odoo-128.png",
    },
  });
  menuIds.add(MENU_ID_IMPORTER);
}

browser.menus.onShown.addListener((info) => {
  const selectedCount = info.selectedMessages?.messages?.length ?? 0;
  const visible = selectedCount === 1;
  for (const id of menuIds) {
    browser.menus.update(id, { visible: visible });
  }
  browser.menus.refresh();
});

function extractMessageId(rawMail) {
  const decoded = decodeRawMail(rawMail);
  const match = decoded.match(/^Message-ID:\s*<[^>]+>/im);
  return match ? match[0].replace(/^Message-ID:\s*/i, "") : null;
}

function extractPredecessorIds(rawMail) {
  const decoded = decodeRawMail(rawMail);
  const ids = [];

  const irtMatch = decoded.match(/^In-Reply-To:\s*<[^>]+>/im);
  if (irtMatch) {
    ids.push(irtMatch[0].replace(/^In-Reply-To:\s*/i, "").trim());
  }

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
    width: 480,
    height: 160,
  });
  return new Promise((resolve) => {
    const cleanup = () => {
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

function normalizeResult(result, model) {
  if (typeof result === "object" && result !== null) {
    return result;
  }
  if (result) {
    return { status: "ok", model: model || false, thread_id: result, message_id: false, is_unattached: false };
  }
  if (result === false) {
    return { status: "duplicate", model: model || false, thread_id: false, message_id: false, is_unattached: false };
  }
  return { status: "ignored", model: model || false, thread_id: false, message_id: false, is_unattached: false };
}

async function showImportResult(cfg, rawMail, normalized, prefix) {
  if (normalized.status === "duplicate") {
    const msgId = extractMessageId(rawMail);
    if (msgId) {
      try {
        const found = await findMail(cfg, msgId);
        if (found.status === "found") {
          await showResult("Email already in Odoo (duplicate)", found, cfg, true);
          return;
        }
      } catch (_) {}
    }
  }
  await showResult(prefix, normalized, cfg, true);
}

async function handleOdooImporter(info) {
  try {
    const message = info.selectedMessages?.messages?.[0];
    if (!message) {
      throw new Error("Select exactly one email");
    }

    const hasPermission = await browser.permissions.contains({
      origins: ["*://*/*"],
    });
    if (!hasPermission) {
      throw new Error(
        "Host permission not granted. Open the add-on options and click 'Test connection' to grant access.",
      );
    }

    const rawMail = await messenger.messages.getRaw(message.id);
    const messageId = extractMessageId(rawMail);
    if (!messageId) {
      throw new Error("Could not extract Message-Id from email");
    }
    console.debug("handleOdooImporter: Message-Id=" + messageId);

    const cfg = await get_config();

    // Step 1: Find the email itself in Odoo
    const result = await findMail(cfg, messageId);
    if (result.status === "found") {
      await showResult("Email found in Odoo", result, cfg, true);
      return;
    }

    // Step 2: Not found — check predecessor(s) from In-Reply-To / References
    const predecessorIds = extractPredecessorIds(rawMail);
    let predFound = null;
    for (const pid of predecessorIds) {
      console.debug("Checking predecessor: " + pid);
      predFound = await findMail(cfg, pid);
      if (predFound.status === "found") break;
    }

    if (predFound?.status === "found") {
      const url = buildUrl(cfg, predFound.model, predFound.thread_id, predFound.message_id, predFound.is_unattached);
      const btnIdx = await showDialog(
        "Odoo Email Importer",
        "Predecessor email found" + (url ? " at " + url : "") + ". Import this email?",
        [{ title: "Import", value: 0 }, { title: "Cancel", value: -1 }],
      );
      if (btnIdx === 0) {
        const importResult = await uploadMail(cfg, rawMail);
        const normalized = normalizeResult(importResult);
        await showImportResult(cfg, rawMail, normalized, "Email imported");
      }
      return;
    }

    // Step 3: No predecessor found — offer import options
    const btnIdx = await showDialog(
      "Odoo Email Importer",
      "This email and its predecessor are not in Odoo. How do you want to import it?",
      [{ title: "As CRM Lead", value: 0 }, { title: "As Lost Message", value: 1 }],
    );
    if (btnIdx === 0) {
      const importResult = await uploadMail(cfg, rawMail, "crm.lead");
      const normalized = normalizeResult(importResult, "crm.lead");
      await showImportResult(cfg, rawMail, normalized, "Email imported as CRM Lead");
    } else if (btnIdx === 1) {
      const importResult = await uploadMail(cfg, rawMail);
      const normalized = normalizeResult(importResult);
      await showImportResult(cfg, rawMail, normalized, "Email imported");
    }
  } catch (err) {
    notify("Odoo – Error", err.message);
  }
}

browser.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId === MENU_ID_IMPORTER) {
    await handleOdooImporter(info);
  }
});

browser.runtime.onMessage.addListener(async (msg) => {
  try {
    if (msg.action === "testConnection") {
      const info = await getConnectionInfo(msg.config);
      return { ok: true, info };
    }

    if (msg.action === "setup") {
      await setup();
      return { ok: true };
    }

    if (msg.action === "uploadMail") {
      await uploadMail(msg.config, msg.rawMail);
      return { ok: true };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

await setup();
