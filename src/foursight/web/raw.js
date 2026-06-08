var graphData = null;
var canvas = null;
var ctx = null;
var nodePositions = {};
var tooltip = null;
var currentRole = "reviewer";

var COLORS = {
  critical: "#ff6b6b",
  high: "#ffb347",
  medium: "#ffd700",
  low: "#4caf50",
  none: "#4a4e56",
  bg: "#0f1115",
  edgeDecomp: "#3a5a3a",
  edgeDep: "#3a3a6b",
  text: "#e6e6e6",
  textDim: "#6a6e76",
  hoverBg: "#1a1d24",
};

function role() { return document.getElementById("role").value; }

function sevColor(severity) {
  return COLORS[severity] || COLORS.none;
}

function sevClass(severity) {
  var map = {critical:"sev-critical", high:"sev-high", medium:"sev-medium", low:"sev-low"};
  return map[severity] || "";
}

async function refresh() {
  currentRole = role();
  var r = await fetch("/graph-raw?role=" + currentRole);
  graphData = await r.json();
  layoutAndDraw();
}

function layoutAndDraw() {
  if (!graphData) return;
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d");
  tooltip = document.getElementById("tooltip");

  // Compute layers via simple topological sort approximation
  var layers = {};
  var visited = {};
  var remaining = {};
  graphData.nodes.forEach(function(n) { remaining[n.id] = true; });

  // Repeated passes: assign layer = max(parent layer + 1)
  var changed = true;
  var passes = 0;
  while (changed && passes < 50) {
    changed = false;
    passes++;
    graphData.nodes.forEach(function(n) {
      var maxParentLayer = -1;
      var allParentsSeen = true;
      graphData.edges.forEach(function(e) {
        if (e.dst === n.id && e.type === "decomposition") {
          if (!(e.src in layers)) allParentsSeen = false;
          else if (layers[e.src] > maxParentLayer) maxParentLayer = layers[e.src];
        }
      });
      if (allParentsSeen && !(n.id in layers)) {
        // Also check dependency edges don't break ordering
        var depParentsOk = true;
        graphData.edges.forEach(function(e) {
          if (e.dst === n.id && e.type === "dependency") {
            if (!(e.src in layers)) depParentsOk = false;
          }
        });
        if (depParentsOk) {
          layers[n.id] = maxParentLayer + 1;
          changed = true;
        }
      }
    });
  }
  // Assign layer 0 to any remainder
  graphData.nodes.forEach(function(n) {
    if (!(n.id in layers)) layers[n.id] = 0;
  });

  // Group nodes by layer
  var layerGroups = {};
  graphData.nodes.forEach(function(n) {
    var l = layers[n.id];
    if (!layerGroups[l]) layerGroups[l] = [];
    layerGroups[l].push(n);
  });

  var maxLayer = Math.max.apply(null, Object.keys(layerGroups).map(Number));

  // Canvas dimensions
  var W = 1100;
  var marginX = 180;
  var marginY = 60;
  var layerH = 100;
  var H = marginY * 2 + (maxLayer + 1) * layerH + 40;
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  canvas.onmousemove = onMouseMove;
  canvas.onclick = onCanvasClick;
  canvas.onmouseleave = function() { tooltip.style.display = "none"; };

  // Clear
  ctx.fillStyle = "#0a0c10";
  ctx.fillRect(0, 0, W, H);

  // Compute positions
  nodePositions = {};
  var layerKeys = Object.keys(layerGroups).map(Number).sort(function(a,b) { return a - b; });
  layerKeys.forEach(function(l) {
    var nodes = layerGroups[l];
    var count = nodes.length;
    var y = marginY + l * layerH + layerH / 2;
    var spacing = (W - marginX * 2) / Math.max(count, 1);
    nodes.forEach(function(n, i) {
      var x = marginX + spacing * (i + 0.5);
      nodePositions[n.id] = {x: x, y: y, node: n};
    });
  });

  // Draw edges
  graphData.edges.forEach(function(e) {
    var from = nodePositions[e.src];
    var to = nodePositions[e.dst];
    if (!from || !to) return;
    var isDep = e.type === "dependency";
    ctx.strokeStyle = isDep ? COLORS.edgeDep : COLORS.edgeDecomp;
    ctx.lineWidth = isDep ? 1.2 : 1.8;
    if (isDep) ctx.setLineDash([5, 4]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    // Curved line
    var midX = (from.x + to.x) / 2;
    var midY = (from.y + to.y) / 2;
    ctx.moveTo(from.x, from.y + 13);
    ctx.quadraticCurveTo(midX, midY, to.x, to.y - 13);
    ctx.stroke();
    // Arrowhead
    var arrowSize = 6;
    var angle = Math.atan2(to.y - from.y, to.x - from.x);
    var ax = to.x - Math.cos(angle) * 13;
    var ay = to.y - Math.sin(angle) * 13;
    ctx.setLineDash([]);
    ctx.fillStyle = isDep ? COLORS.edgeDep : COLORS.edgeDecomp;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - arrowSize * Math.cos(angle - 0.6), ay - arrowSize * Math.sin(angle - 0.6));
    ctx.lineTo(ax - arrowSize * Math.cos(angle + 0.6), ay - arrowSize * Math.sin(angle + 0.6));
    ctx.closePath();
    ctx.fill();
  });

  // Draw nodes
  graphData.nodes.forEach(function(n) {
    var pos = nodePositions[n.id];
    if (!pos) return;
    var radius = n.kind === "task" ? 16 : 12;
    var color = sevColor(n.severity);

    // Glow
    var glow = ctx.createRadialGradient(pos.x, pos.y, radius * 0.5, pos.x, pos.y, radius * 2);
    glow.addColorStop(0, color + "30");
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius * 2, 0, Math.PI * 2);
    ctx.fill();

    // Circle
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner dot for tasks
    if (n.kind === "task") {
      ctx.fillStyle = COLORS.bg;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Label
    ctx.fillStyle = COLORS.text;
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    var label = n.title.length > 22 ? n.title.slice(0, 20) + ".." : n.title;
    ctx.fillText(label, pos.x, pos.y - radius - 8);

    // Severity label
    if (n.severity) {
      ctx.fillStyle = color;
      ctx.font = "bold 10px system-ui, sans-serif";
      ctx.fillText(n.severity.toUpperCase(), pos.x, pos.y - radius - 22);
    }
  });

  // Legend
  var legendY = 20;
  ["low", "medium", "high", "critical"].forEach(function(s, i) {
    var lx = marginX + i * 110;
    ctx.fillStyle = sevColor(s);
    ctx.beginPath();
    ctx.arc(lx, legendY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.textDim;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "start";
    ctx.fillText(s.toUpperCase(), lx + 10, legendY + 4);
  });
  // Edge legend
  var ex = marginX + 4 * 110 + 40;
  ctx.strokeStyle = COLORS.edgeDecomp;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(ex, legendY); ctx.lineTo(ex + 30, legendY);
  ctx.stroke();
  ctx.fillStyle = COLORS.textDim;
  ctx.fillText("decomp", ex + 35, legendY + 4);
  var ex2 = ex + 100;
  ctx.strokeStyle = COLORS.edgeDep;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(ex2, legendY); ctx.lineTo(ex2 + 30, legendY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillText("dep", ex2 + 35, legendY + 4);
}

function onMouseMove(e) {
  var rect = canvas.getBoundingClientRect();
  var scaleX = canvas.width / rect.width;
  var mx = (e.clientX - rect.left) * scaleX;
  var my = (e.clientY - rect.top) * scaleX;
  var found = null;
  var bestDist = 40;
  Object.keys(nodePositions).forEach(function(nid) {
    var p = nodePositions[nid];
    var dx = mx - p.x, dy = my - p.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) { bestDist = dist; found = p; }
  });
  if (found) {
    var n = found.node;
    tooltip.style.display = "block";
    tooltip.style.left = (found.x * rect.width / canvas.width + 16) + "px";
    tooltip.style.top = (found.y * rect.width / canvas.width - 20) + "px";
    var sev = n.severity || "";
    var sc = sevClass(sev);
    tooltip.innerHTML =
      "<div class=\"tt-title\">" + n.title + " <span class=\"sev " + sc + "\">" + sev.toUpperCase() + "</span></div>" +
      "<div class=\"tt-meta\">" + n.kind + " &middot; " + n.id + "</div>" +
      "<div class=\"tt-meta\" style=\"margin-top:4px;opacity:0.7;\">click to open report</div>";
    canvas.style.cursor = "pointer";
  } else {
    tooltip.style.display = "none";
    canvas.style.cursor = "default";
  }
}

async function onCanvasClick(e) {
  var rect = canvas.getBoundingClientRect();
  var scaleX = canvas.width / rect.width;
  var mx = (e.clientX - rect.left) * scaleX;
  var my = (e.clientY - rect.top) * scaleX;
  var found = null;
  var bestDist = 30;
  Object.keys(nodePositions).forEach(function(nid) {
    var p = nodePositions[nid];
    var dx = mx - p.x, dy = my - p.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) { bestDist = dist; found = p; }
  });
  if (found) showReport(found.node.id);
}

async function showReport(nodeId) {
  var r = await fetch("/report/" + nodeId + "?role=" + currentRole);
  var rep = await r.json();
  var det = document.getElementById("detail");
  if (!rep) { det.style.display = "none"; return; }
  det.style.display = "block";
  var sc = sevClass(rep.severity);
  det.innerHTML =
    "<h3>" + rep.node_id + " <span class=\"sev " + sc + "\">" + rep.severity.toUpperCase() + "</span></h3>" +
    "<p style=\"line-height:1.5;\">" + rep.overall + "</p>" +
    (rep.drivers && rep.drivers.length
      ? "<p style=\"opacity:0.6;\">Drivers: " + rep.drivers.map(function(d) { return d.line; }).join("; ") + "</p>"
      : "") +
    "<p style=\"margin-top:8px;\"><a href=\"/?node=" + nodeId + "\" style=\"color:#6b8cff;\">open in report viewer &rsaquo;</a></p>";
}
