var _lastAction = null;
var _ignoreNextCacheChange = false;
var _pendingAction = false;

function renderBar(d, container) {
  var old = document.getElementById("odoo-status-bar");
  if (old) old.remove();

  if (d && d.status) {
    window._odooDebug = JSON.stringify(d);
  } else {
    console.debug("renderBar: no data", d);
    return null;
  }

  var b = document.createElement("div");
  b.id = "odoo-status-bar";
  b.style.cssText =
    "display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 12px;font-size:13px;font-family:-moz-info,sans-serif;border-bottom:1px solid #ccc;background:#f5f5f5";

  var l = document.createElement("span");

  var btnRow = document.createElement("div");
  btnRow.style.cssText = "width:100%;display:flex;gap:6px";

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

  function renderStatusLine(l, status, label, modelUrl, messageUrl) {
    if (label) l.appendChild(document.createTextNode(label));
    appendUrls(l, modelUrl, messageUrl);
    appendStatusElement(l, status);
  }

  l.appendChild(document.createTextNode("Odoo: "));

  if (d.status === "found") {
    renderStatusLine(l, d.status, null, d.modelUrl, d.messageUrl);
  } else if (d.status === "parent_found") {
    renderStatusLine(
      l,
      d.status,
      "not found, only parent ",
      d.parentModelUrl,
      d.parentMessageUrl,
    );
  } else if (d.status === "not_found") {
    renderStatusLine(l, d.status, "not found", null, null);
  }

  if (_lastAction) {
    var a = document.createElement("span");
    a.textContent = " [" + _lastAction + "]";
    a.style.cssText = "font-size:11px;color:#888";
    l.appendChild(a);
  }

  var btnStyle =
    "padding:2px 10px;font-size:12px;cursor:pointer;border:1px solid #aaa;border-radius:3px;background:#fff;white-space:nowrap";
  btnRow.appendChild(
    createButton(
      "Verify",
      function () {
        doAction("verifyMessage");
      },
      null,
      btnStyle,
    ),
  );
  if (d.status === "parent_found" || d.status === "not_found") {
    btnRow.appendChild(
      createButton(
        "Add",
        function () {
          doAction("addMessage");
        },
        null,
        btnStyle,
      ),
    );
  }

  b.appendChild(l);
  b.appendChild(btnRow);
  container.insertBefore(b, container.firstChild);
  return b;
}

function doAction(action) {
  if (_pendingAction) return;
  _pendingAction = true;
  messenger.runtime
    .sendMessage({ action: action })
    .then(
      function (r) {
        _pendingAction = false;
        if (r && r.status) {
          if (action === "addMessage" && !r.success) {
            _lastAction = null;
          } else {
            _lastAction = action === "verifyMessage" ? "verified" : "added";
            if (r.urlCopied) _lastAction += ", URL copied";
          }
          _ignoreNextCacheChange = true;
          var container =
            document.getElementById("messagepane") || document.body;
          renderBar(r, container);
          return;
        }
        refreshBar();
      },
      function () {
        _pendingAction = false;
        refreshBar();
      },
    )
    .catch(function () {
      _pendingAction = false;
    });
}

function refreshBar() {
  _lastAction = null;
  messenger.runtime
    .sendMessage({ action: "getOdooStatus" })
    .then(
      function (data) {
        var container = document.getElementById("messagepane") || document.body;
        renderBar(data, container);
      },
      function (err) {
        console.debug("refreshBar error:", err);
      },
    )
    .catch(function () {});
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
