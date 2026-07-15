function combineUrl(base, ...parts) {
  var url = base.replace(/\/+$/, "");
  for (var i = 0; i < parts.length; i++) {
    url += "/" + parts[i].replace(/^\/+|\/+$/g, "");
  }
  return url;
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

function makeIconLink(icon, url) {
  var b = document.createElement("a");
  b.href = url;
  b.target = "_blank";
  b.rel = "noreferrer";
  b.textContent = icon;
  b.title = url;
  b.style.cssText =
    "display:inline-flex;align-items:center;justify-content:center;width:1.3em;height:1.3em;font-size:11px;border:1px solid #aaa;border-radius:3px;text-decoration:none;cursor:pointer;color:#555;margin-left:2px";
  return b;
}

function createButton(text, onClick, tooltip, style) {
  var n = document.createElement("button");
  n.textContent = text;
  if (tooltip) n.title = tooltip;
  if (style) n.style.cssText = style;
  n.addEventListener("click", onClick);
  return n;
}
