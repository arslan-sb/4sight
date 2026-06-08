function role() { return document.getElementById("role").value; }

function sevDot(severity) {
  if (!severity) return "sev-dot-none";
  var map = {critical:"sev-dot-critical", high:"sev-dot-high", medium:"sev-dot-medium", low:"sev-dot-low"};
  return map[severity] || "sev-dot-none";
}

function sevBadge(severity) {
  if (!severity) return "";
  var map = {critical:"sev-critical", high:"sev-high", medium:"sev-medium", low:"sev-low"};
  return "<span class=\"sev " + (map[severity] || "") + "\">" + severity.toUpperCase() + "</span>";
}

async function refresh() {
  var r = await fetch("/graph-raw?role=" + role());
  var data = await r.json();
  renderNodes(data.nodes);
  renderEdges(data.edges);
}

function renderNodes(nodes) {
  var el = document.getElementById("nodes");
  var html = "";
  nodes.forEach(function(n) {
    var dot = sevDot(n.severity);
    html += "<div class=\"n-card\">" +
      "<span class=\"sev-dot " + dot + "\"></span>" +
      "<span class=\"title\">" + n.title + " <span class=\"kind\">" + n.kind + "</span></span>" +
      sevBadge(n.severity) +
      "</div>";
  });
  el.innerHTML = html;
}

function renderEdges(edges) {
  var el = document.getElementById("edges");
  var html = "";
  edges.forEach(function(e) {
    var cls = e.type === "decomposition" ? "edge-decomp" : "edge-dep";
    var typeLabel = e.type === "decomposition" ? "DECOMP" : "DEP";
    html += "<div class=\"edge-row " + cls + "\">" +
      "<span class=\"edge-src\">" + (e.src_title || e.src) + "</span>" +
      "<span class=\"edge-arrow\">&rarr;</span>" +
      "<span class=\"edge-dst\">" + (e.dst_title || e.dst) + "</span>" +
      "<span class=\"edge-type\">" + typeLabel + "</span>" +
      "</div>";
  });
  el.innerHTML = html;
}
