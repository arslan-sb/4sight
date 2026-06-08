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
    html += "<div class=\"n-card\" onclick=\"showReport('" + n.id + "')\" style=\"cursor:pointer;\">" +
      "<span class=\"sev-dot " + dot + "\"></span>" +
      "<span class=\"title\">" + n.title + " <span class=\"kind\">" + n.kind + "</span></span>" +
      sevBadge(n.severity) +
      "</div>";
  });
  el.innerHTML = html;
  document.getElementById("detail").style.display = "none";
}

async function showReport(nodeId) {
  var r = await fetch("/report/" + nodeId + "?role=" + role());
  var rep = await r.json();
  var det = document.getElementById("detail");
  if (!rep) { det.style.display = "none"; return; }
  det.style.display = "block";
  var sevMap = {critical:"sev-critical", high:"sev-high", medium:"sev-medium", low:"sev-low"};
  var sc = sevMap[rep.severity] || "";
  det.innerHTML =
    "<h3>" + rep.node_id + " <span class=\"sev " + sc + "\">" + rep.severity.toUpperCase() + "</span></h3>" +
    "<p style=\"line-height:1.5;\">" + rep.overall + "</p>" +
    (rep.drivers && rep.drivers.length
      ? "<p style=\"opacity:0.6;\">Drivers: " + rep.drivers.map(function(d) { return d.line; }).join("; ") + "</p>"
      : "");
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
