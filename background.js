/********************************************************************
 * Odoo Mail Importer – Thunderbird MailExtension
 * Odoo >= 19
 ********************************************************************/

import { testOdooConnection, getConnectionInfo, findMail } from "./lib/odooClient.js";
import { uploadMail, decodeRawMail } from "./lib/odooMailUpload.js";

const MENU_ID_PREFIX = "send-to-odoo";
const MENU_ID_FIND = "send-to-odoo-find";

// Menu ids created by setup(), used by onShown to toggle visibility
// based on how many messages are currently selected.
const menuIds = new Set();
menuIds.add(MENU_ID_FIND);

function notify(title, message, sticky = false) {
  console.debug(title + ": " + message);
  // Use a unique id per notification so a later one does not replace an
  // earlier one (e.g. a failure right after a success).
  browser.notifications.create("thunderbird2odoo-" + Date.now(), {
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/odoo-48.png"),
    title: title,
    message: message,
    // sticky: keep the notification visible until the user dismisses it
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

// Build notification title and message from a unified result dict
// (returned by both import_mail and find_mail).
// Returns {title, message} or null if no notification should be shown.
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

// Show a notification from a unified result dict, with clipboard + sticky.
async function showResult(prefix, r, sticky = false) {
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
  // load Odoo config from options
  const cfg = await browser.storage.local.get([
    "url",
    "db",
    "apikey",
    "models",
  ]);
  return cfg;
}

async function setup() {
  browser.menus.removeAll();
  menuIds.clear();
  const cfg = await get_config();

  if (!cfg.url || !cfg.apikey) {
    // not configured yet, empty menus, nothing to do
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

  // "Find in Odoo" menu item — created first so it appears at the top
  browser.menus.create({
    id: MENU_ID_FIND,
    title: "Find Email in Odoo",
    contexts: ["message_list"],
    icons: {
      16: "icons/odoo-16.png",
      32: "icons/odoo-32.png",
      48: "icons/odoo-48.png",
      96: "icons/odoo-96.png",
      128: "icons/odoo-128.png",
    },
  });

  for (const item of cfg.models) {
    let model = false;
    let id = MENU_ID_PREFIX;
    let title = "Import Email into Odoo";
    if (item !== "false") {
      model = item;
      id = MENU_ID_PREFIX + "-" + model;
      title = "Import Email into Odoo as " + model;
    }
    // create a context menu
    browser.menus.create({
      id: id,
      title: title,
      contexts: ["message_list"],
      icons: {
        16: "icons/odoo-16.png",
        32: "icons/odoo-32.png",
        48: "icons/odoo-48.png",
        96: "icons/odoo-96.png",
        128: "icons/odoo-128.png",
      },
    });
    menuIds.add(id);
  }
}

// Only show the import menu items when exactly one email is selected.
// This gives the user direct feedback that multi-selection is not supported.
browser.menus.onShown.addListener((info) => {
  const selectedCount = info.selectedMessages?.messages?.length ?? 0;
  const visible = selectedCount === 1;
  for (const id of menuIds) {
    browser.menus.update(id, { visible: visible });
  }
  browser.menus.refresh();
});

// Extract the Message-Id header from a raw RFC822 email
function extractMessageId(rawMail) {
  const decoded = decodeRawMail(rawMail);
  const match = decoded.match(/^Message-ID:\s*<[^>]+>/im);
  return match ? match[0].replace(/^Message-ID:\s*/i, "") : null;
}

// Handle "Find in Odoo" menu click
async function handleFindInOdoo(info) {
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
    console.debug("findInOdoo: looking up Message-Id " + messageId);

    const cfg = await get_config();
    const result = await findMail(cfg, messageId);
    console.debug("findInOdoo: result=" + JSON.stringify(result));

    if (result.status === "not_found") {
      notify("Odoo", "Email not found in Odoo (Message-Id: " + messageId + ")");
    } else {
      await showResult("Email found", result, true);
    }
  } catch (err) {
    notify("Odoo – Error", "Failed to find email: " + err.message);
  }
}

// handle menu click
browser.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId === MENU_ID_FIND) {
    await handleFindInOdoo(info);
    return;
  }
  if (!info.menuItemId.startsWith(MENU_ID_PREFIX)) return;

  // extract string after: prefix + "-"
  let model = info.menuItemId.slice(MENU_ID_PREFIX.length + 1);
  if (!model) {
    model = false;
  }

  try {
    const message = info.selectedMessages?.messages?.[0];
    if (!message) {
      throw new Error("Select exactly one email");
    }

    // Check host permission before attempting any fetch. Without it,
    // fetch() fails with a cryptic NetworkError (CORS). This guides
    // upgrading users who had <all_urls> in the old version but need
    // to grant the optional permission in the new version.
    const hasPermission = await browser.permissions.contains({
      origins: ["*://*/*"],
    });
    if (!hasPermission) {
      throw new Error(
        "Host permission not granted. Open the add-on options and click 'Test connection' to grant access.",
      );
    }

    // get raw email
    const rawMail = await messenger.messages.getRaw(message.id);

    // load Odoo config from options
    const cfg = await get_config();

    const import_result = await uploadMail(cfg, rawMail, model);

    // uploadMail returns either:
    //   - a dict from import_mail: {status, model, thread_id, message_id, is_unattached, url}
    //   - a raw value from message_process: thread_id (int), false, null
    if (typeof import_result === "object" && import_result !== null) {
      // import_mail path (mail_manual_routing installed)
      if (import_result.status === "duplicate") {
        // Duplicate: look up where the existing message is stored
        const msgId = extractMessageId(rawMail);
        if (msgId) {
          const found = await findMail(cfg, msgId);
          if (found.status === "found") {
            await showResult("Email already in Odoo (duplicate)", found);
            return;
          }
        }
      }
      await showResult("Email successfully transferred", import_result);
    } else {
      // message_process fallback (unmodified Odoo)
      if (import_result) {
        if (model) {
          notify("Odoo", "Email successfully transferred to Odoo as " + model + " " + import_result);
        } else {
          notify("Odoo", "Email successfully transferred to Odoo (thread " + import_result + ")");
        }
      } else if (import_result === false) {
        // Duplicate: try to look up where it is stored
        const msgId = extractMessageId(rawMail);
        if (msgId) {
          try {
            const found = await findMail(cfg, msgId);
            if (found.status === "found") {
              await showResult("Email already in Odoo (duplicate)", found);
              return;
            }
          } catch (_) {}
        }
        notify("Odoo", "Email not imported: Message-Id already exists in Odoo (duplicate)");
      } else {
        notify("Odoo", "Email not imported: ignored by Odoo (loop detection or bounce)");
      }
    }
  } catch (err) {
    notify("Odoo – Error", "Failed to send email: " + err.message);
  }
});

// handle runtime messages from options.js
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
