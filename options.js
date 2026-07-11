const urlInput = document.getElementById("url");
const dbInput = document.getElementById("db");
const apiKeyInput = document.getElementById("apikey");
const testBtn = document.getElementById("test");
const saveBtn = document.getElementById("save");
const clearCacheBtn = document.getElementById("clearCache");
const status = document.getElementById("status");

const maxAgeInput = document.getElementById("maxAgeDays");
const syncLimitInput = document.getElementById("syncLimit");
const saveSyncBtn = document.getElementById("saveSync");
const syncNowBtn = document.getElementById("syncNow");
const cacheInfo = document.getElementById("cacheInfo");

let lastValidHash = null;

function getConfig() {
  return {
    url: urlInput.value.trim(),
    apikey: apiKeyInput.value.trim(),
    db: dbInput.value.trim() || null,
  };
}

function hash(cfg) {
  return JSON.stringify(cfg);
}

function invalidate() {
  lastValidHash = null;
  saveBtn.disabled = true;
  status.textContent = "Please test the connection";
}

(async () => {
  const stored = await browser.storage.local.get(["url", "db", "apikey", "maxAgeDays", "syncLimit"]);
  if (stored.url) urlInput.value = stored.url;
  if (stored.db) dbInput.value = stored.db;
  if (stored.apikey) apiKeyInput.value = stored.apikey;
  if (stored.maxAgeDays !== undefined) maxAgeInput.value = stored.maxAgeDays;
  if (stored.syncLimit !== undefined) syncLimitInput.value = stored.syncLimit;
  invalidate();
  refreshCacheInfo();
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

    const info = result.info;
    status.textContent = "Connection successful";
    if (info?.userInfo) {
      const u = info.userInfo;
      const code = document.createElement("code");
      code.textContent = u.login;
      status.appendChild(document.createTextNode(" as "));
      status.appendChild(code);
      if (u.name) {
        status.appendChild(document.createTextNode(" (" + u.name + ")"));
      }
    }
  } else {
    status.textContent = "Failed: " + (result?.error || "unknown error");
  }
});

clearCacheBtn.addEventListener("click", async () => {
  const result = await browser.runtime.sendMessage({ action: "clearCache" });
  status.textContent = result?.ok ? "Odoo cache cleared" : "Failed to clear cache";
  refreshCacheInfo();
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

saveSyncBtn.addEventListener("click", async () => {
  const maxAgeDays = parseInt(maxAgeInput.value, 10) || 365;
  const syncLimit = parseInt(syncLimitInput.value, 10) || 10000;
  await browser.storage.local.set({ maxAgeDays, syncLimit });
  status.textContent = "Sync settings saved";
  refreshCacheInfo();
});

syncNowBtn.addEventListener("click", async () => {
  syncNowBtn.disabled = true;
  status.textContent = "Syncing from Odoo…";
  const result = await browser.runtime.sendMessage({ action: "syncFromOdoo" });
  if (result?.ok) {
    status.textContent = "Sync complete";
  } else {
    status.textContent = "Sync failed";
  }
  syncNowBtn.disabled = false;
  refreshCacheInfo();
});

async function refreshCacheInfo() {
  const info = await browser.runtime.sendMessage({ action: "getCacheInfo" });
  if (!info) return;
  let text = "Cached entries: " + info.size;
  if (info.lastSync) {
    const d = new Date(info.lastSync);
    text += " | Last sync: " + d.toLocaleString();
  }
  cacheInfo.textContent = text;
}
