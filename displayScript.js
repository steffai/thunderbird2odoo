function renderBar(d, container) {
  if (!d || !d.status) return null;

  var old = document.getElementById("odoo-status-bar");
  if (old) old.remove();

  var b = document.createElement("div");
  b.id = "odoo-status-bar";
  b.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 12px;font-size:13px;font-family:-moz-info,sans-serif;border-bottom:1px solid #ccc;background:#f5f5f5";

  var l = document.createElement("span");

  var btnRow = document.createElement("div");
  btnRow.style.cssText = "width:100%;display:flex;gap:6px";

  function addBtn(text, onClick) {
    var n = document.createElement("button");
    n.textContent = text;
    n.style.cssText = "padding:2px 10px;font-size:12px;cursor:pointer;border:1px solid #aaa;border-radius:3px;background:#fff;white-space:nowrap";
    n.addEventListener("click", onClick);
    btnRow.appendChild(n);
  }

  function makeLink(url) {
    var a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = url;
    a.style.cssText = "color:#1a73e8;text-decoration:underline;cursor:pointer";
    return a;
  }

  l.appendChild(document.createTextNode("Odoo: "));

  if (d.status === "found") {
    if (d.url) l.appendChild(makeLink(d.url));
    var dot = document.createElement("span");
    dot.textContent = " \u25CF";
    dot.style.color = "#1b8a1b";
    l.appendChild(dot);
  } else if (d.status === "parent_found") {
    l.appendChild(document.createTextNode("not found, only parent "));
    if (d.parentUrl) l.appendChild(makeLink(d.parentUrl));
    var dot = document.createElement("span");
    dot.textContent = " \u25CF";
    dot.style.color = "#d49a00";
    l.appendChild(dot);
  } else if (d.status === "not_found") {
    l.appendChild(document.createTextNode("not found"));
    var x = document.createElement("span");
    x.textContent = " \u2715";
    x.style.color = "#c0392b";
    l.appendChild(x);
  }

  addBtn("Verify", function () { sendAction("verifyMessage", container); });
  if (d.status === "parent_found" || d.status === "not_found") {
    addBtn("Add", function () { sendAction("addMessage", container); });
  }

  b.appendChild(l);
  b.appendChild(btnRow);
  container.insertBefore(b, container.firstChild);
  return b;
}

function sendAction(action, container) {
  messenger.runtime.sendMessage({ action: action }).then(function (r) {
    if (r && r.status) {
      var url = r.url || r.parentUrl;
      if (url) {
        navigator.clipboard.writeText(url).catch(function () {});
      }
      renderBar(r, container);
    }
  });
}

function refreshBar() {
  messenger.runtime.sendMessage({ action: "getOdooStatus" }).then(function (data) {
    if (!data || !data.status) return;
    var container = document.getElementById("messagepane") || document.body;
    renderBar(data, container);
  });
}

messenger.storage.onChanged.addListener(function (changes, area) {
  if (area === "local" && changes.odooMailCache) {
    refreshBar();
  }
});

refreshBar();
