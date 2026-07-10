const urlInput = document.getElementById("url");
const dbInput = document.getElementById("db");
const apiKeyInput = document.getElementById("apikey");
const testBtn = document.getElementById("test");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

const DEFAULT_MODELS = ["false", "crm.lead"];
let lastValidHash = null;

function getConfig() {
  return {
    url: urlInput.value.trim(),
    apikey: apiKeyInput.value.trim(),
    db: dbInput.value.trim() || null,
    models: Array.from(
      document.querySelectorAll("input[type=checkbox]:checked"),
    ).map((cb) => cb.value),
  };
}

function hash(cfg) {
  return JSON.stringify(cfg);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[c];
  });
}

function invalidate() {
  lastValidHash = null;
  saveBtn.disabled = true;
  status.textContent = "Please test the connection";
}

(async () => {
  const stored = await browser.storage.local.get([
    "url",
    "db",
    "apikey",
    "models",
  ]);
  if (stored.url) urlInput.value = stored.url;
  if (stored.db) dbInput.value = stored.db;
  if (stored.apikey) apiKeyInput.value = stored.apikey;
  let models = DEFAULT_MODELS;
  if (stored.models) models = stored.models;

  document.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.checked = models.includes(cb.value);
  });

  invalidate();
})();

[urlInput, dbInput, apiKeyInput].forEach((el) =>
  el.addEventListener("input", invalidate),
);

testBtn.addEventListener("click", async () => {
  const cfg = getConfig();

  if (!cfg.url || !cfg.apikey) {
    status.textContent = "URL and API key are required";
    return;
  }

  if (cfg.models.length === 0) {
    status.textContent = "At least one Odoo model must be selected";
    return;
  }

// Request host permission so fetch() can bypass CORS. This must be the
  // first await in the click handler: permissions.request() may only be
  // called from a user input handler, and any prior await breaks that
  // context. If the permission is already granted, request() returns true
  // without prompting.
  // We request the broad *://*/* pattern because origin-specific patterns
  // with ports (e.g. http://localhost:8019/*) don't properly grant CORS
  // bypass in Thunderbird. Unlike <all_urls> in permissions (granted at
  // install time without consent), this is optional_permissions and the
  // user is explicitly prompted.
  const granted = await browser.permissions.request({
    origins: ["*://*/*"],
  });
  if (!granted) {
    status.textContent =
      "Host permission is required to connect to your Odoo server";
    return;
  }
  console.debug("testConnection: host permission granted");

  status.textContent = "Testing connection…";
  saveBtn.disabled = true;

  const result = await browser.runtime.sendMessage({
    action: "testConnection",
    config: cfg,
  });

  if (result?.ok) {
    lastValidHash = hash(cfg);
    saveBtn.disabled = false;

    // build a detailed status message from connection info
    const info = result.info;
    let html = "Connection successful";
    if (info?.userInfo) {
      const u = info.userInfo;
      html += " as <code>" + escapeHtml(u.login) + "</code>";
      if (u.name) {
        html += " (" + escapeHtml(u.name) + ")";
      }
    }
    status.innerHTML = html;
  } else {
    status.textContent = "Failed: " + (result?.error || "unknown error");
  }
});

document.getElementById("settings").addEventListener("submit", async (e) => {
  e.preventDefault();

  const cfg = getConfig();
  if (hash(cfg) !== lastValidHash) {
    status.textContent = "Please test before saving";
    return;
  }

  await browser.storage.local.set(cfg);

  const result = await browser.runtime.sendMessage({
    action: "setup",
  });

  if (result?.ok) {
    status.textContent = "Settings saved";
  } else {
    status.textContent = "Saved, but setup failed: " + (result?.error || "unknown error");
  }
});
