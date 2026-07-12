var _lastAction = null;
var _ignoreNextCacheChange = false;

function renderBar(d, container) {
  var old = document.getElementById("odoo-status-bar");
  if (old) old.remove();

  if (d && d.status) {
    window._odooDebug = JSON.stringify(d);
  } else {
    console.debug("renderBar: no data", d); return null;
  }

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
  
  function appendStatusElement(l, status) {
    var e = document.createElement("span");
    if (status === "found") {
      e.textContent = " \u25CF";
      e.style.color = "#1b8a1b";
    } else if (status === "parent_found") {
      e.textContent = " \u25CF";
      e.style.color = "#d49a00";
    } else if (status === "not_found") {
      e.textContent = " \u2715";
      e.style.color = "#c0392b";
    } else {
      return;
    }
    l.appendChild(e);
  }
  
  function appendUrls(l, modelUrl, messageUrl) {
    if (modelUrl) {
      l.appendChild(makeLink(modelUrl));
      l.appendChild(document.createTextNode(" "));
    }
    if (messageUrl && messageUrl !== modelUrl) {
      l.appendChild(makeLink(messageUrl));
      l.appendChild(document.createTextNode(" "));
    }
  }

  l.appendChild(document.createTextNode("Odoo: "));

  if (d.status === "found") {
    appendUrls(l, d.modelUrl, d.messageUrl);
    appendStatusElement(l, d.status);
  } else if (d.status === "parent_found") {
    l.appendChild(document.createTextNode("not found, only parent "));
    appendUrls(l, d.parentModelUrl, d.parentMessageUrl);
    appendStatusElement(l, d.status);
  } else if (d.status === "not_found") {
    l.appendChild(document.createTextNode("not found"));
    appendStatusElement(l, d.status);
  }

  if (_lastAction) {
    var a = document.createElement("span");
    a.textContent = " [" + _lastAction + "]";
    a.style.cssText = "font-size:11px;color:#888";
    l.appendChild(a);
  }

  addBtn("Verify", function () { doAction("verifyMessage"); });
  if (d.status === "parent_found" || d.status === "not_found") {
    addBtn("Add", function () { doAction("addMessage"); });
  }

  b.appendChild(l);
  b.appendChild(btnRow);
  container.insertBefore(b, container.firstChild);
  return b;
}

function doAction(action) {
  messenger.runtime.sendMessage({ action: action }).then(function (r) {
    if (r && r.status) {
      if (action === "addMessage" && !r.success) {
        _lastAction = null;
      } else {
        _lastAction = action === "verifyMessage" ? "verified" : "added";
        if (r.urlCopied) _lastAction += ", URL copied";
      }
      _ignoreNextCacheChange = true;
      var container = document.getElementById("messagepane") || document.body;
      renderBar(r, container);
      return;
    }
    refreshBar();
  }, function () {
    refreshBar();
  }).catch(function () {});
}

function refreshBar() {
  messenger.runtime.sendMessage({ action: "getOdooStatus" }).then(function (data) {
    var container = document.getElementById("messagepane") || document.body;
    renderBar(data, container);
  }, function (err) {
    console.debug("refreshBar error:", err);
  }).catch(function () {});
}

messenger.runtime.onMessage.addListener(function (msg) {
  if (msg.action === "refreshOdooStatus") {
    refreshBar();
  }
});

messenger.storage.onChanged.addListener(function (changes, area) {
  if (area === "local" && changes.odooMailCache) {
    if (_ignoreNextCacheChange) {
      _ignoreNextCacheChange = false;
      return;
    }
    refreshBar();
  }
});

refreshBar();
