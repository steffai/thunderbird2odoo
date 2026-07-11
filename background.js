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
  if (menuIds.size === 0) return;
  const selectedCount = info.selectedMessages?.messages?.length ?? 0;
  const visible = selectedCount === 1;
  for (const id of menuIds) {
    browser.menus.update(id, { visible: visible });
  }
  browser.menus.refresh();
});

function extractMessageId(decoded) {
  const match = decoded.match(/^Message-ID:\s*<[^>]+>/im);
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

async function uploadAndShowResult(cfg, model, prefix, decoded) {
  const rawResult = await uploadMail(cfg, decoded, model);
  console.debug("uploadAndShowResult: rawResult=" + JSON.stringify(rawResult));

  if (rawResult) {
    // message_process returned a thread_id — email was routed successfully.
    // Try to find it via findMail to show the URL.
    const messageId = extractMessageId(decoded);
    if (messageId) {
      try {
        const found = await findMail(cfg, messageId);
        if (found.status === "found") {
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
    // message_process returned false: could be a new lost message or a duplicate.
    const messageId = extractMessageId(decoded);
    if (messageId) {
      try {
        const found = await findMail(cfg, messageId);
        if (found.status === "found") {
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
    notify("Odoo", "Email not imported: Odoo could not route this email to any model");
  } else {
    // null: ignored / bounce
    notify("Odoo", "Email not imported: ignored by Odoo (loop detection or bounce)");
  }
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
    const decoded = decodeRawMail(rawMail);
    const messageId = extractMessageId(decoded);
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
    const predecessorIds = extractPredecessorIds(decoded);
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
        [{ title: "Import", value: 0 }],
      );
      if (btnIdx === 0) {
        await uploadAndShowResult(cfg, false, "Email imported", decoded);
      }
      return;
    }

    // Step 3: No predecessor found — offer import options
    const btnIdx = await showDialog(
      "Odoo Email Importer",
      "This email and its predecessor are not in Odoo. How do you want to import it?",
      [{ title: "As Opportunity (CRM Lead)", value: 0 }, { title: "Generic", value: 1, tooltip: "Might fail on Odoo 19 without Lost Messages module, see https://github.com/joergsteffens/thunderbird2odoo" }],
    );
    if (btnIdx === 0) {
      await uploadAndShowResult(cfg, "crm.lead", "Email imported as Opportunity (CRM Lead)", decoded);
    } else if (btnIdx === 1) {
      await uploadAndShowResult(cfg, false, "Email imported", decoded);
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
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

await setup();
