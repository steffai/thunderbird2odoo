function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function linkify(text) {
  return escapeHtml(text).replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1">$1</a>',
  );
}

(async () => {
  const params = new URLSearchParams(location.search);
  document.title = params.get("title") || "Odoo Email Importer";
  document.getElementById("message").innerHTML =
    linkify(params.get("message") || "");

  const win = await browser.windows.getCurrent();
  let buttons;
  try {
    buttons = JSON.parse(params.get("buttons"));
  } catch {
    buttons = [];
  }

  const container = document.getElementById("buttons");
  for (const btn of buttons) {
    const el = document.createElement("button");
    el.textContent = btn.title;
    if (btn.tooltip) el.title = btn.tooltip;
    el.addEventListener("click", () => {
      browser.runtime.sendMessage({
        action: "dialogChoice",
        windowId: win.id,
        choice: btn.value,
      });
      window.close();
    });
    container.appendChild(el);
  }

  if (buttons.length === 0) {
    const el = document.createElement("button");
    el.textContent = "OK";
    el.addEventListener("click", () => window.close());
    container.appendChild(el);
  }

  document.addEventListener("click", (e) => {
    const anchor = e.target.closest("a");
    if (anchor) {
      e.preventDefault();
      window.open(anchor.href, "_blank");
    }
  });
})();
