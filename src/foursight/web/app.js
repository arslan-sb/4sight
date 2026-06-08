let stack = [];
let rootNode = null;

function role() { return document.getElementById("role").value; }

function sevClass(severity) {
  var map = {critical:"sev-critical", high:"sev-high", medium:"sev-medium", low:"sev-low"};
  return map[severity] || "";
}

function drvClass(severity) {
  var map = {critical:"sev-critical", high:"sev-high", medium:"sev-medium", low:"sev-low"};
  return map[severity] || "";
}

async function findRoot() {
  var r = await fetch("/root");
  var data = await r.json();
  rootNode = data.node_id;
}

async function load(nodeId) {
  if (!nodeId) return;
  var r = await fetch("/report/" + nodeId + "?role=" + role());
  render(nodeId, await r.json());
}

function render(nodeId, rep) {
  document.getElementById("crumb").textContent = stack.join("  >  ");
  var el = document.getElementById("report");
  if (!rep) { el.innerHTML = "<p>No report yet.</p>"; return; }
  var sc = sevClass(rep.severity);
  var html =
    "<h2>" + rep.node_id + " <span class=\"sev " + sc + "\">" + rep.severity.toUpperCase() + "</span></h2>" +
    "<p style=\"line-height:1.6;\">" + rep.overall + "</p>";

  if (rep.drivers && rep.drivers.length) {
    html += "<h4>Drivers</h4>";
    rep.drivers.forEach(function(d) {
      var dc = drvClass(d.severity);
      var isSelf = d.node_id === rep.node_id;
      if (isSelf) {
        html += "<div class=\"driver\"><span>" + d.line + "</span><span class=\"driver-sev " + dc + "\">" + d.severity.toUpperCase() + "</span></div>";
      } else {
        html += "<div class=\"driver\" onclick=\"drill('" + d.node_id + "')\"><span>" + d.line + " &rsaquo;</span><span class=\"driver-sev " + dc + "\">" + d.severity.toUpperCase() + "</span></div>";
      }
    });
  }

  if (rep.watch_items && rep.watch_items.length) {
    html += "<p style=\"opacity:0.6;margin-top:14px;\">Watch: " + rep.watch_items.join(", ") + "</p>";
  }
  el.innerHTML = html;
}

function drill(nodeId) { if (!nodeId) return; stack.push(nodeId); load(nodeId); }

async function simulate(kind) {
  await fetch("/simulate-change", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ kind }) });
  stack = [rootNode]; load(rootNode);
}

async function reload() {
  var nodeId = stack.length > 0 ? stack[stack.length - 1] : rootNode;
  if (nodeId) load(nodeId);
}

async function boot() {
  await findRoot();
  stack = [rootNode];
  load(rootNode);
  try {
    var ws = new WebSocket("ws://" + location.host + "/ws");
    ws.onmessage = function() { reload(); };
  } catch (e) { /* mock server has no ws; ignore */ }
}
