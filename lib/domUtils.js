function makeLink(url) {
  var a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = url;
  a.style.cssText = "color:#1a73e8;text-decoration:underline;cursor:pointer";
  return a;
}

function createButton(text, onClick, tooltip, style) {
  var n = document.createElement("button");
  n.textContent = text;
  if (tooltip) n.title = tooltip;
  if (style) n.style.cssText = style;
  n.addEventListener("click", onClick);
  return n;
}
