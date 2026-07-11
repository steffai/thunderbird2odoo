const CACHE_KEY = "odooMailCache";

export async function getCachedResult(messageId) {
  const data = await browser.storage.local.get(CACHE_KEY);
  const cache = data[CACHE_KEY] || {};
  return cache[String(messageId)] || null;
}

export async function setCachedResult(messageId, entry) {
  const data = await browser.storage.local.get(CACHE_KEY);
  const cache = data[CACHE_KEY] || {};
  cache[String(messageId)] = entry;
  await browser.storage.local.set({ [CACHE_KEY]: cache });
}

export async function clearAllCache() {
  await browser.storage.local.remove(CACHE_KEY);
}

export async function getCacheSize() {
  const data = await browser.storage.local.get(CACHE_KEY);
  const cache = data[CACHE_KEY] || {};
  return Object.keys(cache).length;
}

const SYNC_KEY = "lastOdooSync";

export async function getLastSync() {
  const data = await browser.storage.local.get(SYNC_KEY);
  return data[SYNC_KEY] || null;
}

export async function setLastSync(timestamp) {
  await browser.storage.local.set({ [SYNC_KEY]: timestamp });
}
