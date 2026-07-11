function renderMessage(text) {
  const el = document.getElementById("message");
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  for (const part of parts) {
    if (part.match(/^https?:\/\//)) {
      const a = document.createElement("a");
      a.href = part;
      a.textContent = part;
      a.rel = "noreferrer";
      el.appendChild(a);
    } else {
      el.appendChild(document.createTextNode(part));
    }
  }
}

(async () => {
  const params = new URLSearchParams(location.search);
  document.title = params.get("title") || "Odoo Email Importer";
  renderMessage(params.get("message") || "");

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
